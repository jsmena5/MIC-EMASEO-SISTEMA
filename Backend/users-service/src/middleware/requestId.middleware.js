import { childLogger } from "../utils/logger.js"

export const requestId = (req, _res, next) => {
  req.log = childLogger(req)
  next()
}
