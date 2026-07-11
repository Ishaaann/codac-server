import { WebSocketServer } from 'ws';
import { URL } from 'url';
import crypto from 'crypto';
import * as Y from 'yjs';
import Document from '../models/Document.js';

export const activeRooms = new Map();

function setUpWebSocketServer(server) {
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
        try {
            const baseUrl = `http://${request.headers.host}`;
            const url = new URL(request.url, baseUrl);
            const pathname = url.pathname;
            const roomMatch = pathname.match(/^\/room\/([^/]+)$/);
            
            if (!roomMatch) {
                socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
                socket.destroy();
                return;
            }
            
            const roomId = roomMatch[1];
            wss.handleUpgrade(request, socket, head, (ws) => {
                ws.roomId = roomId;
                ws.id = crypto.randomUUID();
                wss.emit('connection', ws, request);
            });
        } catch (error) {
            console.error('Error during WebSocket upgrade:', error);
            socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
            socket.destroy();
        }
    });

    // 🚨 FIXED: Removed 'async' from the top level to prevent race conditions
    wss.on('connection', (ws, request) => {
        const roomId = ws.roomId;

        // 1. SYNCHRONOUS INITIALIZATION
        if (!activeRooms.has(roomId)) {
            activeRooms.set(roomId, {
                doc: new Y.Doc(),
                clients: new Set(),
                saveTimeout: null,
                loadPromise: null // We will track the DB load state here
            });

            const newRoom = activeRooms.get(roomId);

            // 2. ASYNC HYDRATION (Happens in the background)
            newRoom.loadPromise = Document.findOne({ roomId }).then(dbDoc => {
                if (dbDoc && dbDoc.state) {
                    Y.applyUpdate(newRoom.doc, dbDoc.state);
                    console.log(`[Room ${roomId}] Hydrated from MongoDB`);
                }
            }).catch(err => console.error(`DB Load Error for room ${roomId}:`, err));
        }

        const room = activeRooms.get(roomId);
        room.clients.add(ws);

        // 3. AUTO-SYNC: Push history to the client immediately after DB loads
        room.loadPromise.then(() => {
            if (ws.readyState === 1) {
                const state = Y.encodeStateAsUpdate(room.doc);
                ws.send(JSON.stringify({ type: 'full_sync', data: Array.from(state) }));
            }
        });

        // 4. SYNCHRONOUS LISTENER: No messages will ever be dropped now
        ws.on('message', async (message) => {
            const textData = message.toString();
            
            let payload;
            try {
                payload = JSON.parse(textData);
            } catch (error) {
                console.error("Received non-JSON message");
                return;
            }
            
            // If the client explicitly asks for sync, wait for DB then send it
            if (payload.type === 'request_sync') {
                room.loadPromise.then(() => {
                    if (ws.readyState === 1) {
                        const state = Y.encodeStateAsUpdate(room.doc);
                        ws.send(JSON.stringify({ type: 'full_sync', data: Array.from(state) }));
                    }
                });
                return; 
            }

            if (payload.type === 'execute') {
                try {
                    // Send the raw code to the OnlineCompiler.io synchronous endpoint
                    // Send the raw code to the OnlineCompiler.io synchronous endpoint
                    // Send the raw code to the OnlineCompiler.io synchronous endpoint
                    const response = await fetch('https://api.onlinecompiler.io/api/run-code-sync/', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': process.env.ONLINE_COMPILER_API_KEY 
                        },
                        body: JSON.stringify({
                            compiler: 'typescript-deno', 
                            code: payload.data
                        })
                    });
                    
                    const result = await response.json();
                    
                    let output = "> Execution failed or timed out.";
                    
                    // Parse the specific response structure from OnlineCompiler
                    if (response.ok && result.status === 'success') {
                        output = result.output;
                    } else if (result.error) {
                        output = result.error;
                    } else if (result.message) {
                        output = result.message; // Catches API/Auth errors
                    }

                    if (!output || output.trim() === '') {
                        output = "> Program exited with no output.";
                    }

                    const outputMessage = JSON.stringify({
                        type: 'execution_result',
                        data: output
                    });

                    // Broadcast the secure cloud output to everyone in the room
                    room.clients.forEach(client => {
                        if (client.readyState === 1) {
                            client.send(outputMessage);
                        }
                    });
                } catch (error) {
                    console.error('Execution Engine Error:', error);
                    ws.send(JSON.stringify({ 
                        type: 'execution_result', 
                        data: `[System Error] Failed to connect to cloud execution engine.` 
                    }));
                }
                return;
            }

            // BROADCAST TO OTHER CLIENTS (Including awareness/cursors)
            room.clients.forEach(client => {
                if (client !== ws && client.readyState === 1) {
                    client.send(textData);
                }
            });

            // THE SILENT OBSERVER (Update server state & save to DB)
            if (payload.type === 'update') {
                try {
                    const updateBuffer = new Uint8Array(payload.data);
                    Y.applyUpdate(room.doc, updateBuffer);

                    clearTimeout(room.saveTimeout);
                    room.saveTimeout = setTimeout(async () => {
                        try {
                            const fullState = Y.encodeStateAsUpdate(room.doc);
                            await Document.findOneAndUpdate(
                                { roomId },
                                { state: Buffer.from(fullState) },
                                { upsert: true, returnDocument: 'after' }
                            );
                            console.log(`[Room ${roomId}] State permanently saved to MongoDB`);
                        } catch (dbError) {
                            console.error('Error saving to DB:', dbError);
                        }
                    }, 5000);

                } catch (error) {
                    console.error('Error syncing server document:', error);
                }
            }
        });

        // 5. CLEANUP
        ws.on('close', () => {
            room.clients.delete(ws);
            
            if (room.clients.size === 0) {
                const finalState = Y.encodeStateAsUpdate(room.doc);
                Document.findOneAndUpdate(
                    { roomId },
                    { state: Buffer.from(finalState) },
                    { upsert: true }
                ).catch(err => console.error('Final DB save error:', err));
                
                clearTimeout(room.saveTimeout);
                activeRooms.delete(roomId);
                console.log(`[Room ${roomId}] Empty, removed from memory.`);
            }
        });
    });
}

export { setUpWebSocketServer };