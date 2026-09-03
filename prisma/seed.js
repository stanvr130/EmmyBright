import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import 'dotenv/config';

// 🌐 Resolve __dirname inside an ES Module environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 💡 FIX: Prisma 7 requires a driver adapter instead of a raw datasources/url object.
// We build a PrismaPg adapter from your DATABASE_URL and pass that to the client.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Seeding EmmyBright inventory matching relational variant architecture via CSV automated processing...');

  const csvFilePath = path.join(__dirname, 'products.csv');
  
  if (!fs.existsSync(csvFilePath)) {
    throw new Error(`Inventory spreadsheet missing! Please ensure your data registry is located at: ${csvFilePath}`);
  }

  // 🔄 READ AND PARSE THE EXTERNAL BULK CSV SPREADSHEET
  const fileContent = fs.readFileSync(csvFilePath, 'utf-8');
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true
  });

  console.log(`📊 Ingested spreadsheet layout. Processing ${records.length} items...`);

  // 🧼 CLEANUP OF PREVIOUS RUN DATA TO MAINTAIN INTEGRITY
  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.variant.deleteMany({});
  await prisma.product.deleteMany({});

  for (const row of records) {
    const productName = row.name.trim();
    
    // 🏷️ PARSE COMMA-SEPARATED VALUES FOR SIZES AND COLORS FROM SPREADSHEET
    const sizeArray = row.sizes ? row.sizes.split(',').map(s => s.trim()) : [];
    const colorVal = row.color ? row.color.trim() : 'Default';

    // 🎯 PARSE STOCK COLUMN FROM SPREADSHEET (Defaults safely to 5 if cell is left empty)
    const stockVal = row.stock ? parseInt(row.stock, 10) : 5;

    // Map raw variants or fallback to standard config arrays if sizes empty, passing the row stock down
    const variantPayload = sizeArray.length > 0 
      ? sizeArray.map(size => ({ size, color: colorVal, stock: stockVal }))
      : [{ size: 'Standard', color: colorVal, stock: stockVal }];

    // 💥 AUTOMATIC SYSTEM COLLISION PROTECTION VIA UPSERT
    await prisma.product.upsert({
      where: { name: productName },
      update: {
        category: row.category.toLowerCase().trim(),
        price: parseFloat(row.price),
        description: row.description ? row.description.trim() : 'Premium selection crafted for absolute comfort and modern elegance.',
        image: `/public-images/${row.image_filename.trim()}`
      },
      create: {
        name: productName,
        category: row.category.toLowerCase().trim(),
        price: parseFloat(row.price),
        description: row.description ? row.description.trim() : 'Premium selection crafted for absolute comfort and modern elegance.',
        image: `/public-images/${row.image_filename.trim()}`,
        variants: {
          create: variantPayload
        }
      }
    });

    console.log(`✅ Synchronized Product Entry: ${productName}`);
  }

  console.log('✅ Database successfully seeded with full Products and Variants collections!');
}

main()
  .catch((e) => {
    console.error('❌ Processing halted on seeding instance:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });