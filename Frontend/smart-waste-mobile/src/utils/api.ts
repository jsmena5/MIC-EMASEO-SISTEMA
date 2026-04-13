import axios from "axios"

const api = axios.create({
  baseURL: "http://192.168.1.151:4000/api", // IP Wi-Fi laptop + puerto API Gateway
  timeout: 5000
})

export default api