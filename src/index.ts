import dotenv from 'dotenv';
dotenv.config();
import express from "express";
import { pool } from "./db";
import cors from "cors";

const app = express();
const PORT = 3000;
app.use(cors());
app.use(express.json());

app.get('/' , (req,res) =>{
      res.send('Hello from my first backend project :)');
});



// Services
app.get('/services', async (req,res) => {
      try{
            const result = await pool.query("SELECT * FROM services");
            res.json(result.rows);
      }

      catch(err){
            console.error(err);
            res.status(500).json({error: 'Failed to fetch services',details: (err as Error).message});
      }
})



// Posting a new service to DB
app.post('/services', async (req,res) => {
      try{
            const { salon_id, name, duration, price } = req.body;

            // Basic validation
            if (      salon_id == null ||
                      !name ||
                      duration == null ||
                      price == null
               ) {
                  return res.status(400).json({ error: "Missing required fields" });
            }
            const result = await pool.query(
                  `INSERT INTO services (salon_id, name, duration_min, price)
                  VALUES ($1, $2, $3, $4)
                  RETURNING *`,
                  [salon_id, name, duration, price]
            );

            res.status(201).json(result.rows[0]);
      }

      catch (err) {
            console.error(err);
            res.status(500).json({ error: "Failed to create service" });
      }
})

app.get('/staff-for-service', async(req, res) => {
  try{
    const {service_id, salon_id} = req.query;

    //Validation
    if(!service_id || !salon_id){
      return res.status(400).json({error: 'Both service_id and salon_id required'})
    }

    const result = await pool.query(
      `SELECT users.id, users.full_name, users.email, users.role 
       From users 
       INNER JOIN staff_services ON users.id = staff_services.staff_user_id
       WHERE users.salon_id   = $1
       AND   staff_services.service_id = $2`,
       [salon_id,service_id]
    );
    res.json(result.rows);

  } catch(err){
    console.error(err);
    res.status(500).json({ error: 'Could not load staff' });
  }
})


// GET /availability/slots - Get free time slots for a staff on a specific date
app.get('/availability/slots', async (req, res) => {
  try {
    const { staff_user_id, service_id, date } = req.query;

    // Basic validation
    if (!staff_user_id || !service_id || !date) {
      return res.status(400).json({ 
        error: "staff_user_id, service_id, and date (YYYY-MM-DD) are required" 
      });
    }

    // Parse date and get day of week
    const selectedDate = new Date(date as string);
    if (isNaN(selectedDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
    }

    // Convert JS getDay() (0=Sun, 1=Mon ... 6=Sat)
    // to DB convention  (1=Mon, 2=Tue ... 6=Sat, 7=Sun)
    const jsDay = selectedDate.getDay();
    const dayOfWeek = jsDay === 0 ? 7 : jsDay;

    // 1. Get service duration
    const serviceRes = await pool.query(
      `SELECT duration_min FROM services WHERE id = $1`,
      [service_id]
    );

    if (serviceRes.rowCount === 0) {
      return res.status(404).json({ error: "Service not found" });
    }

    const durationMin = serviceRes.rows[0].duration_min;

    // 2. Get ALL availability blocks for this staff on this day of week
    const availRes = await pool.query(
      `SELECT start_time, end_time
       FROM availability
       WHERE staff_user_id = $1
         AND day_of_week = $2
       ORDER BY start_time`,
      [staff_user_id, dayOfWeek]
    );

    if (availRes.rowCount === 0) {
      return res.json({
        date: date,
        day_of_week: dayOfWeek,
        free_slots: [],
        message: "Staff is not available on this day of the week"
      });
    }

    // 3. Get all existing appointments for this staff on this date
    const apptRes = await pool.query(
      `SELECT start_time, end_time
       FROM appointments
       WHERE staff_user_id = $1
         AND DATE(start_time) = $2`,
      [staff_user_id, date]
    );

    // 4. Generate slots across ALL availability blocks (morning + afternoon)
    const freeSlots: string[] = [];

    for (const block of availRes.rows) {
      const { start_time: availStart, end_time: availEnd } = block;

      let currentTime = new Date(`${date} ${availStart}`);
      const endTime = new Date(`${date} ${availEnd}`);

      while (currentTime < endTime) {
        const slotEnd = new Date(currentTime.getTime() + durationMin * 60000);

        // Only include slot if it fits entirely within this availability block
        if (slotEnd <= endTime) {
          const slotStartStr = currentTime.toTimeString().slice(0, 5); // e.g. "09:00"

          const isBooked = apptRes.rows.some(appt => {
            const apptStart = new Date(appt.start_time);
            const apptEnd = new Date(appt.end_time);
            return currentTime < apptEnd && slotEnd > apptStart;
          });

          if (!isBooked) {
            freeSlots.push(slotStartStr);
          }
        }

        // Move to next possible start time (every 30 minutes)
        currentTime = new Date(currentTime.getTime() + 30 * 60000);
      }
    }

    res.json({
      date: date,
      day_of_week: dayOfWeek,
      service_duration_min: durationMin,
      free_slots: freeSlots
    });

  } catch (err) {
    console.error('Availability error:', err);
    res.status(500).json({ error: 'Could not fetch availability slots' });
  }
});


app.listen(PORT, () => {
      console.log(`Hello the server is running on http://localhost:${PORT}`);
})



app.get('/appointments', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM appointments');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});


app.post("/appointments", async (req, res) => {
  try {
    const {
      salon_id,
      staff_user_id,
      service_id,
      start_time,
      end_time
    } = req.body;

    if (
      salon_id == null ||
      staff_user_id == null ||
      service_id == null ||
      !start_time ||
      !end_time
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Convert appt times
    const startDate     = new Date(start_time);
    const endDate       = new Date(end_time);

    // Convert JS getDay() (0=Sun) to DB convention (1=Mon, 7=Sun)
    const jsDay         = startDate.getDay();
    const dayOfWeek     = jsDay === 0 ? 7 : jsDay;

    // Extract time only
    const startTimeOnly = startDate.toTimeString().slice(0, 8);
    const endTimeOnly   = endDate.toTimeString().slice(0, 8);

    // Check staff availability — appointment must fall within one of their blocks
    const availability = await pool.query(
      `SELECT 1
       FROM availability
       WHERE staff_user_id = $1
         AND day_of_week   = $2
         AND start_time   <= $3
         AND end_time     >= $4
       LIMIT 1`,
      [staff_user_id, dayOfWeek, startTimeOnly, endTimeOnly]
    );

    if (availability.rowCount === 0) {
      return res.status(409).json({
        error: "Staff is not available at this time"
      });
    }

    // Check overlapping appointments
    const conflict = await pool.query(
      `SELECT 1
       FROM appointments
       WHERE staff_user_id = $1
         AND start_time    < $2
         AND end_time      > $3
       LIMIT 1`,
      [staff_user_id, end_time, start_time]
    );

    if ((conflict.rowCount ?? 0) > 0) {
      return res.status(409).json({
        error: "Staff already has an appointment at this time"
      });
    }

    const result = await pool.query(
      `INSERT INTO appointments
       (salon_id, staff_user_id, service_id, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [salon_id, staff_user_id, service_id, start_time, end_time]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create appointment" });
  }
});
