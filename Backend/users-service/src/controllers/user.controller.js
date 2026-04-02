// src/controllers/user.controller.js

import { pool } from "../db.js"

export const registerUser = async (req, res) => {
  try {
    const {
      nombre,
      apellido,
      cedula,
      username,
      email,
      password,
      ciudad
    } = req.body

    const result = await pool.query(
      `INSERT INTO users 
      (nombre, apellido, cedula, username, email, password, ciudad)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *`,
      [nombre, apellido, cedula, username, email, password, ciudad]
    )

    res.json(result.rows[0])

  } catch (error) {
    console.error(error)
    res.status(500).json({ message: "Error en servidor" })
  }
}