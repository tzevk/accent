import { dbConnect } from "../../../utils/database";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const function_id = searchParams.get("function_id");
    const db = await dbConnect();

    let rows = [];
    if (function_id) {
      [rows] = await db.query(
        "SELECT * FROM activities_master WHERE function_id = ?",
        [function_id]
      );
    } else {
      [rows] = await db.query("SELECT * FROM activities_master");
    }

    await db.end();
    return Response.json(rows || []); // 👈 ensures JSON is always sent
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
    });
  }
}

export async function POST(req) {
  try {
    const data = await req.json();
    const db = await dbConnect();
    await db.execute(
      "INSERT INTO activities_master (function_id, activity_name, default_manhours, default_duration) VALUES (?, ?, ?, ?)",
      [
        data.function_id || null,
        data.activity_name,
        data.default_duration,
        data.default_manhours,
      ]
    );
    await db.end();

    return Response.json({ message: "Activity added successfully" });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
    });
  }
}

export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const activity_id = searchParams.get("activity_id");

    if (!id) {
      return new Response(JSON.stringify({ error: "Missing activity ID" }));
    }

    const db = await dbConnect();
    await db.execute("DELETE FROM activities_master WHERE id = ?", [
      activity_id,
    ]);
    await db.end();

    return Response.json({ message: "Activity Deleted Successfully" });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }
}
