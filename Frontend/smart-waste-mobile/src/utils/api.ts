import axios from "axios"

const api = axios.create({
  baseURL: "http://192.168.100.56:3000/api", // solo IP base
  timeout: 5000
})

export default api