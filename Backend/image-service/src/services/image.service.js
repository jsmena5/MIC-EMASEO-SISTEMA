export const validateImage = async (req, res) => {
  try {
    const { image } = req.body

    if (!image) {
      return res.status(400).json({ valid: false })
    }

    // SIMULACIÓN DE VALIDACIÓN DE DISTANCIA
    // (más adelante puedes usar IA o OpenCV)

    const randomDistance = Math.random()

    if (randomDistance > 0.5) {
      return res.json({
        valid: true,
        message: "Distancia correcta"
      })
    }

    return res.json({
      valid: false,
      message: "Acércate más al objeto"
    })

  } catch (error) {
    res.status(500).json({ valid: false })
  }
}