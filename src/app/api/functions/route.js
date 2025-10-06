import { dbConnect } from "../../../utils/database";

export async function GET() {
  const db = await dbConnect();
  const [rows] = await db.query(`
    SELECT 
      f.id,
      f.function_name,
      f.description,
      f.status,
      COUNT(a.id) AS activity_count
    FROM functions_master f
    LEFT JOIN activities_master a ON f.id = a.function_id
    GROUP BY f.id
    ORDER BY f.function_name;
  `);
  await db.end();
  return Response.json(rows);
}

export async function POST(req) {
  const data = await req.json();
  const db = await dbConnect();
  await db.execute(
    "INSERT INTO functions_master (function_name, description, status) VALUES (?, ?, ?)",
    [data.function_name, data.description || null, data.status || "active"]
  );
  await db.end();
  return Response.json({
    message: "Function added successfully",
  });
}
