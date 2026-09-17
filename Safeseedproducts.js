import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Strip sslmode from the URL — its presence overrides the explicit ssl
// config below, same fix applied in src/config/db.js
const cleanedUrl = process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]+/, '');
const adapter = new PrismaPg({
  connectionString: cleanedUrl,
  ssl: { rejectUnauthorized: false }
});
const prisma = new PrismaClient({ adapter });

// Maps CSV's short category labels ("suit", "shoe") to your real Category
// table's names. Adjust the right-hand values if your actual category
// names differ from these.
const CATEGORY_NAME_MAP = {
  suit: 'Be Spoke Suits',
  shoe: 'Italian Shoes'
};

async function getOrCreateCategoryId(rawCategoryLabel) {
  const label = rawCategoryLabel.toLowerCase().trim();
  const targetName = CATEGORY_NAME_MAP[label] || rawCategoryLabel.trim();

  let category = await prisma.category.findFirst({
    where: { name: { equals: targetName, mode: 'insensitive' } }
  });

  if (!category) {
    category = await prisma.category.create({ data: { name: targetName } });
    console.log(`   ↳ Created new category: ${targetName}`);
  }

  return category.id;
}

async function main() {
  console.log('🌱 Safely seeding EmmyBright inventory from CSV (no existing data will be deleted)...');

  const csvFilePath = path.join(__dirname, 'products.csv');

  if (!fs.existsSync(csvFilePath)) {
    throw new Error(`Inventory spreadsheet missing! Expected at: ${csvFilePath}`);
  }

  const fileContent = fs.readFileSync(csvFilePath, 'utf-8');
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true
  });

  console.log(`📊 Ingested spreadsheet. Processing ${records.length} items...`);

  let createdCount = 0;
  let skippedCount = 0;

  for (const row of records) {
    const productName = row.name.trim();

    // Skip if this product already exists (by unique name) — this script
    // is designed to ONLY add missing products, never touch existing ones.
    const existing = await prisma.product.findUnique({ where: { name: productName } });
    if (existing) {
      console.log(`⏭️  Skipping "${productName}" — already exists in database.`);
      skippedCount++;
      continue;
    }

    const categoryId = await getOrCreateCategoryId(row.category);

    const sizeArray = row.sizes ? row.sizes.split(',').map(s => s.trim()) : [];
    const stockVal = row.stock ? parseInt(row.stock, 10) : 5;

    const variantPayload = sizeArray.length > 0
      ? sizeArray.map(size => ({ size, color: null, stock: stockVal }))
      : [{ size: 'Standard', color: null, stock: stockVal }];

    // Clean the stray replacement-character glitch (�) some descriptions have
    const cleanDescription = row.description
      ? row.description.replace(/\uFFFD/g, '').trim()
      : 'Premium selection crafted for absolute comfort and modern elegance.';

    await prisma.product.create({
      data: {
        name: productName,
        description: cleanDescription,
        price: parseFloat(row.price),
        categoryId,
        image: `/public-images/${row.image_filename.trim()}`,
        variants: {
          create: variantPayload
        }
      }
    });

    console.log(`✅ Added: ${productName}`);
    createdCount++;
  }

  console.log(`\n🎉 Done. Created ${createdCount} new product(s). Skipped ${skippedCount} already-existing product(s).`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding halted:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });