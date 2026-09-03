// seedAll.js
import bcrypt from 'bcryptjs';
import prisma from './src/config/db.js';

async function main() {
  // 1. Create or ensure test Admin user
  const hashedPassword = await bcrypt.hash('admin123', 10);
  
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@test.com' },
    update: {},
    create: {
      name: 'Test Admin',
      email: 'admin@test.com',
      password: hashedPassword,
      role: 'ADMIN' // Adjust if your schema uses isAdmin: true or role enum
    }
  });

  console.log(`✅ Admin user ready: ${adminUser.email} (ID: ${adminUser.id})`);

  // 2. Create a test order for this user
  const order = await prisma.order.create({
    data: {
      userId: adminUser.id,
      totalAmount: 25000,
      shippingAddress: '123 Innovation Way, Lagos',
      phone: '08012345678',
      status: 'Pending',
      paymentStatus: 'Paid'
    }
  });

  console.log(`✅ Test Order created with ID: #${order.id}`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });