import prisma from './src/config/db.js';

async function migrateCategories() {
  const products = await prisma.product.findMany({
    where: { category: { not: null } },
  });

  const uniqueCategoryNames = [
    ...new Set(products.map((p) => p.category.trim()).filter(Boolean)),
  ];

  console.log(`Found ${uniqueCategoryNames.length} unique categories:`, uniqueCategoryNames);

  const categoryMap = {};

  for (const name of uniqueCategoryNames) {
    const category = await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    categoryMap[name] = category.id;
  }

  let updatedCount = 0;
  for (const product of products) {
    const trimmedName = product.category?.trim();
    if (trimmedName && categoryMap[trimmedName]) {
      await prisma.product.update({
        where: { id: product.id },
        data: { categoryId: categoryMap[trimmedName] },
      });
      updatedCount++;
    }
  }

  console.log(`Linked ${updatedCount} products to their new categories.`);
  process.exit(0);
}

migrateCategories().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});