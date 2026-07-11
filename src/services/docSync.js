import * as Y from 'yjs';
export const activeDocs = new Map();

export function getOrCreateDoc(roomID) {
    if(!activeDocs.has(roomID)) {
        const doc = new Y.Doc();
        activeDocs.set(roomID, doc);
    }
    return activeDocs.get(roomID);
}

export function applyClientUpdate(roomID, update){
    try{
        const doc = getOrCreateDoc(roomID);
        Y.applyUpdate(doc, update);
    }
    catch(e){
        console.error(`Error applying update to doc ${roomID}:`, e);
    }
}

export function exportDocState(roomID){
    try{
        const doc = getOrCreateDoc(roomID);
        return Y.encodeStateAsUpdate(doc);
    }
    catch(e){
        console.error(`Error exporting state for doc ${roomID}:`, e);
    }
}