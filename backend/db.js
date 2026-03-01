const mysql = require('mysql2/promise')
const dotenv = require('dotenv')

dotenv.config()


//piu connesioni contemporanee (non bisogna ogni volta chiamare connect o end)
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'gamehub',
  waitForConnections: true,  //se tutte le connessioni sono occupate, aspetta
  connectionLimit: 10,  //massimo 10 connessioni contemporanee
  queueLimit: 0,    //0 = nessun limite alla coda di attesa
})

async function testConn() {
    try {
        const conn = await pool.getConnection();
        console.log('Database connected at port ', process.env.DB_PORT || 3306);
        conn.release();
    } catch (err) {
        console.error('Database connection failed:', err);
    }
}
testConn();

module.exports = pool
