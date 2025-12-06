import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import express from "express";
import cors from "cors";

// Inicializar Firebase Admin
admin.initializeApp();
const db = admin.firestore();
const storage = admin.storage();

// Crear app Express
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// ============================================
// HELPER: Respuesta estándar
// ============================================
interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  message: string;
}

function successResponse<T>(data: T, message = "Success"): ApiResponse<T> {
  return { success: true, data, message };
}

function errorResponse(message: string): ApiResponse<null> {
  return { success: false, data: null, message };
}

// ============================================
// TRANSACCIONES - CRUD
// ============================================

// GET /transactions - Lista todas (con filtros opcionales)
app.get("/transactions", async (req, res) => {
  try {
    const { text, type, categoryIds } = req.query;

    let query: admin.firestore.Query = db.collection("transactions");

    // Filtro por tipo (INCOME o EXPENSE)
    if (type) {
      query = query.where("type", "==", type);
    }

    // Filtro por categorías (categoryIds es string separado por comas)
    if (categoryIds) {
      const ids = (categoryIds as string).split(",").map((id) => id.trim());
      query = query.where("category", "in", ids);
    }

    const snapshot = await query.orderBy("date", "desc").get();
    let transactions = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Filtro por texto (búsqueda en note y category) - se hace en memoria
    if (text && typeof text === "string") {
      const searchText = text.toLowerCase();
      transactions = transactions.filter((tx: any) => {
        const note = (tx.note || "").toLowerCase();
        const category = (tx.category || "").toLowerCase();
        return note.includes(searchText) || category.includes(searchText);
      });
    }

    return res.json(successResponse(transactions));
  } catch (error: any) {
    console.error("Error getting transactions:", error);
    return res.status(500).json(errorResponse(error.message));
  }
});

// GET /transactions/:id - Obtener una transacción por ID
app.get("/transactions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await db.collection("transactions").doc(id).get();

    if (!doc.exists) {
      return res.status(404).json(errorResponse("Transaction not found"));
    }

    return res.json(successResponse({ id: doc.id, ...doc.data() }));
  } catch (error: any) {
    console.error("Error getting transaction:", error);
    return res.status(500).json(errorResponse(error.message));
  }
});

// POST /transactions - Crear nueva transacción
app.post("/transactions", async (req, res) => {
  try {
    const { amount, category, type, date, note, photoUrl } = req.body;

    // Validación básica
    if (!amount || !category || !type || !date) {
      return res.status(400).json(
        errorResponse("Missing required fields: amount, category, type, date")
      );
    }

    const transaction = {
      amount: parseFloat(amount),
      category,
      type,
      date,
      note: note || "",
      photoUrl: photoUrl || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection("transactions").add(transaction);
    const newDoc = await docRef.get();

    return res.status(201).json(
      successResponse(
        { id: docRef.id, ...newDoc.data() },
        "Transaction created successfully"
      )
    );
  } catch (error: any) {
    console.error("Error creating transaction:", error);
    return res.status(500).json(errorResponse(error.message));
  }
});

// PUT /transactions/:id - Actualizar transacción
app.put("/transactions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, category, type, date, note, photoUrl } = req.body;

    const docRef = db.collection("transactions").doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json(errorResponse("Transaction not found"));
    }

    const updates: any = {};
    if (amount !== undefined) updates.amount = parseFloat(amount);
    if (category !== undefined) updates.category = category;
    if (type !== undefined) updates.type = type;
    if (date !== undefined) updates.date = date;
    if (note !== undefined) updates.note = note;
    if (photoUrl !== undefined) updates.photoUrl = photoUrl;
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    await docRef.update(updates);
    const updated = await docRef.get();

    return res.json(
      successResponse(
        { id: updated.id, ...updated.data() },
        "Transaction updated successfully"
      )
    );
  } catch (error: any) {
    console.error("Error updating transaction:", error);
    return res.status(500).json(errorResponse(error.message));
  }
});

// DELETE /transactions/:id - Eliminar transacción
app.delete("/transactions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const docRef = db.collection("transactions").doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json(errorResponse("Transaction not found"));
    }

    // Si tiene foto, eliminarla del Storage
    const data = doc.data();
    if (data?.photoUrl) {
      try {
        // Extraer el path del Storage desde la URL
        const bucket = storage.bucket();
        const fileName = data.photoUrl.split("/").pop();
        if (fileName) {
          await bucket.file(`receipts/${fileName}`).delete();
        }
      } catch (err) {
        console.warn("Error deleting photo from storage:", err);
      }
    }

    await docRef.delete();
    return res.json(successResponse(null, "Transaction deleted successfully"));
  } catch (error: any) {
    console.error("Error deleting transaction:", error);
    return res.status(500).json(errorResponse(error.message));
  }
});

// GET /totals - Obtener totales (income, expense)
app.get("/totals", async (req, res) => {
  try {
    const snapshot = await db.collection("transactions").get();

    let income = 0;
    let expense = 0;

    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.type === "INCOME") {
        income += Math.abs(data.amount);
      } else if (data.type === "EXPENSE") {
        expense += Math.abs(data.amount);
      }
    });

    const balance = income - expense;

    return res.json(successResponse({ income, expense, balance }));
  } catch (error: any) {
    console.error("Error calculating totals:", error);
    return res.status(500).json(errorResponse(error.message));
  }
});

// ============================================
// CATEGORÍAS - CRUD
// ============================================

// GET /categories - Lista todas
app.get("/categories", async (req, res) => {
  try {
    const snapshot = await db.collection("categories").get();
    const categories = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return res.json(successResponse(categories));
  } catch (error: any) {
    console.error("Error getting categories:", error);
    return res.status(500).json(errorResponse(error.message));
  }
});

// GET /categories/:id - Obtener una categoría
app.get("/categories/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const doc = await db.collection("categories").doc(id).get();

    if (!doc.exists) {
      return res.status(404).json(errorResponse("Category not found"));
    }

    return res.json(successResponse({ id: doc.id, ...doc.data() }));
  } catch (error: any) {
    console.error("Error getting category:", error);
    return res.status(500).json(errorResponse(error.message));
  }
});

// POST /categories - Crear categoría
app.post("/categories", async (req, res) => {
  try {
    const { name, color, icon } = req.body;

    if (!name) {
      return res.status(400).json(errorResponse("Name is required"));
    }

    const category = {
      name,
      color: color || null,
      icon: icon || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection("categories").add(category);
    const newDoc = await docRef.get();

    return res.status(201).json(
      successResponse(
        { id: docRef.id, ...newDoc.data() },
        "Category created successfully"
      )
    );
  } catch (error: any) {
    console.error("Error creating category:", error);
    return res.status(500).json(errorResponse(error.message));
  }
});

// PUT /categories/:id - Actualizar categoría
app.put("/categories/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, color, icon } = req.body;

    const docRef = db.collection("categories").doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json(errorResponse("Category not found"));
    }

    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (color !== undefined) updates.color = color;
    if (icon !== undefined) updates.icon = icon;
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();

    await docRef.update(updates);
    const updated = await docRef.get();

    return res.json(
      successResponse(
        { id: updated.id, ...updated.data() },
        "Category updated successfully"
      )
    );
  } catch (error: any) {
    console.error("Error updating category:", error);
    return res.status(500).json(errorResponse(error.message));
  }
});

// DELETE /categories/:id - Eliminar categoría
app.delete("/categories/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const docRef = db.collection("categories").doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.status(404).json(errorResponse("Category not found"));
    }

    await docRef.delete();
    return res.json(successResponse(null, "Category deleted successfully"));
  } catch (error: any) {
    console.error("Error deleting category:", error);
    return res.status(500).json(errorResponse(error.message));
  }
});

// ============================================
// UPLOAD - Subir imagen a Firebase Storage
// ============================================

// POST /upload - Subir imagen (base64)
app.post("/upload", async (req, res) => {
  try {
    const { imageBase64, fileName } = req.body;

    if (!imageBase64) {
      return res.status(400).json(errorResponse("Image data is required"));
    }

    // Generar nombre único si no se proporciona
    const name = fileName || `receipt_${Date.now()}.jpg`;
    const bucket = storage.bucket();
    const file = bucket.file(`receipts/${name}`);

    // Decodificar base64 y subir
    const buffer = Buffer.from(imageBase64, "base64");
    await file.save(buffer, {
      metadata: { 
        contentType: "image/jpeg",
        cacheControl: "public, max-age=31536000"
      }
    });
    
    await file.makePublic();

    // Obtener URL pública
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/receipts/${name}`;

    return res.json(successResponse({ url: publicUrl, fileName: name }));
  } catch (error: any) {
    console.error("Error uploading image:", error);
    return res.status(500).json(errorResponse(error.message));
  }
});

// DELETE /upload/:fileName - Eliminar imagen
app.delete("/upload/:fileName", async (req, res) => {
  try {
    const { fileName } = req.params;
    const bucket = storage.bucket();
    await bucket.file(`receipts/${fileName}`).delete();

    return res.json(successResponse(null, "Image deleted successfully"));
  } catch (error: any) {
    console.error("Error deleting image:", error);
    return res.status(500).json(errorResponse(error.message));
  }
});

// ============================================
// Exportar la API como Cloud Function
// ============================================
export const api = functions.https.onRequest(app);