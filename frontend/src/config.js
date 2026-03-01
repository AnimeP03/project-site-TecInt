// For LAN access: use same hostname with port 4000
// Dynamically uses whatever hostname the browser is viewing from
// Can be overridden with .env variables for production deployments

const apiHost = import.meta.env.VITE_API_HOST || window.location.hostname
const apiPort = import.meta.env.VITE_API_PORT 
const apiProtocol = import.meta.env.VITE_API_PROTOCOL || window.location.protocol.replace(':', '')

export const API_BASE_URL = `${apiProtocol}://${apiHost}:${apiPort}`
