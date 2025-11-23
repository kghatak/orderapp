import mongoose from "mongoose";

const RollSchema = mongoose.Schema({
    rollCode: {type: String, required: true, unique: true},
    maxRoll: {type: Number, required: true, default: 1},
    tenantId: {type: String, required: true, index: true},
});

// Create compound unique index for rollCode + tenantId
RollSchema.index({ rollCode: 1, tenantId: 1 }, { unique: true });
const rollModel = mongoose.model('Roll', RollSchema);

export default rollModel;
