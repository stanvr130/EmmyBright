import 'dotenv/config';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const cleanedUrl = process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]+/, '');

// Only enforce SSL when NOT connecting to a local database — local
// Postgres typically has no SSL support at all, while production
// (Supabase) requires it.
const isLocalDb = cleanedUrl.includes('localhost') || cleanedUrl.includes('127.0.0.1');

const pool = new pg.Pool({
  connectionString: cleanedUrl,
  ...(isLocalDb ? {} : { ssl: { rejectUnauthorized: false } })
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

export { prisma };
export default prisma;
// postgresql://postgres.xewlgqqevmpzpjcvfaxr:zz4nnXzbQ-+bLQ8@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require