import { db } from "@/server/db";

async function checkCols() {
  const userCols = await db.$queryRawUnsafe<any[]>(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'users';
  `);
  console.log("USERS COLUMNS:", userCols.map(c => c.column_name));
}

checkCols().catch(console.error);
