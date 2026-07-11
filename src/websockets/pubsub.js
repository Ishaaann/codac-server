import { createClient } from 'redis';
import { activeRooms } from './wss.js';


const pubClient = createClient({ url: 'redis://localhost:6379' });
const subClient = pubClient.duplicate();

pubClient.on('error', (err) => console.error('Redis Pub Client Error', err));
subClient.on('error', (err) => console.error('Redis Sub Client Error', err));

export async function connectToRedis() {
    await pubClient.connect();
    await subClient.connect();
    console.log('Connected to Redis');
};

export async function publishToRoom(roomId, message, senderId) {
    const payload = JSON.stringify({ message, senderId });
    // await pubClient.publish(roomId, JSON.stringify({ message, senderId }));
    const channelName = `room:${roomId}`;
    await pubClient.publish(channelName, payload);
    console.log(`Published message to room ${roomId}: ${message}`);
}

export async function subscribeToRoom(roomId) {
    const channelName = `room:${roomId}`;
    await subClient.subscribe(channelName, (message) =>{
        const senderId = JSON.parse(message).senderId;
        const data = JSON.parse(message).message;
        const room = activeRooms.get(roomId);
        if(room && room.clients){ 
            room.clients.forEach((ws) => {
                if (ws.id !== senderId && ws.readyState === 1) {
                    ws.send(data);
                }
            });
        }
    });
};