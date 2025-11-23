import mongoose from "mongoose";
//import tenantPlugin from "../util/tenantPlugin.js";

const UserSchema = mongoose.Schema({
    name: {type: String },
    email: { type: String, required: true, unique: true },
    role: { type: String, required: false },
    zone: { type: String, required: false },
    tenantId: { type: String, required: false },
});

// Apply the tenant plugin
//UserSchema.plugin(tenantPlugin);

const userModel = mongoose.model('User', UserSchema);
export default userModel;