import * as admin from "firebase-admin";

// Inicializar Firebase Admin
const serviceAccount = require("../serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const categories = [
  { name: "Food", color: null, icon: "🍔" },
  { name: "Transport", color: null, icon: "🚌" },
  { name: "Health", color: null, icon: "🏥" },
  { name: "Entertainment", color: null, icon: "🎮" },
  { name: "Home", color: null, icon: "🏠" },
  { name: "Salary", color: null, icon: "💰" },
  { name: "Other", color: null, icon: "📌" },
];

async function seedCategories() {
  console.log("🌱 Seeding categories...");

  for (const cat of categories) {
    const docRef = await db.collection("categories").add(cat);
    console.log(`✅ Created: ${cat.name} (ID: ${docRef.id})`);
  }

  console.log("🎉 Seed completed!");
  process.exit(0);
}

seedCategories().catch((error) => {
  console.error("❌ Error seeding:", error);
  process.exit(1);
});