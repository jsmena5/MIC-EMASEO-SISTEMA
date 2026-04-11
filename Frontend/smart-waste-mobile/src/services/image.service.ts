import api from "../utils/api"

export const validateImage = async (imageBase64: string) => {
  try {
    const res = await api.post("/image/validate-image", {
      image: imageBase64
    })

    return res.data
  } catch (error) {
    console.error("Error validando imagen", error)
    throw error
  }
}