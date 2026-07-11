import http from 'http';
import express from 'express';
import { setUpWebSocketServer } from './websockets/wss.js';
import { connectToRedis } from './websockets/pubsub.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const dbPassword = process.env.mongo_db_password;
const dbUser = process.env.mongo_db_user;
const mongoUri = process.env.MONGO_URI;
const app = express();
const port  = process.env.PORT || 8000;

app.use(express.json());
app.use(cors({
    origin: 'https://codac-editor.vercel.app' // NO trailing slash at the end!
}));

app.get('/health', (req, res) => {
    res.status(200).send({ status: 'OK' , message: 'Server is running' });
});

const server = http.createServer(app);

setUpWebSocketServer(server);

async function startServer(){
    try{
        if(!dbPassword && !process.env.MONGO_URI){
            throw new Error('Missing MongoDB credentials: set MONGO_URI or mongo_db_password');
        }

        await mongoose.connect(mongoUri);
        console.log('Connected to MongoDB');

        await connectToRedis();

        server.listen(port, () => {
            console.log(`Server is running on port ${port}`);
        });
    } catch (error) {
        console.error('Error starting server:', error);
        process.exit(1);
    }
}

startServer();