import mongoose from 'mongoose';

const DocumentSchema = new mongoose.Schema({
    roomId:{
        type: String,
        required: true,
        unique: true,
        index: true
    },

    state:{
        type: Buffer,
        required: true
    }
}, { timestamps: true });

export default mongoose.model('Document', DocumentSchema);