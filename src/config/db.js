import 'dotenv/config';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// Strip sslmode from the URL — its presence overrides the explicit ssl config below
const cleanedUrl = process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]+/, '');

const pool = new pg.Pool({
  connectionString: cleanedUrl,
  ssl: { rejectUnauthorized: false }
});
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

export { prisma };
export default prisma;