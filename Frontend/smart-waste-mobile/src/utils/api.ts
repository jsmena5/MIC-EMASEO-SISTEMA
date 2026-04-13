import axios from "axios"

const api = axios.create({
  baseURL: "http://192.168.1.151:4000/api", // IP Wi-Fi laptop + puerto API Gateway
  timeout: 50000 // 15s — necesario para DB + SMTP (Gmail puede tardar 8s+)
})

export default api