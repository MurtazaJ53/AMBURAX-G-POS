import { db } from '../server/db'; async function main() { console.log(await db.outboxEvent.findMany()); } main();
