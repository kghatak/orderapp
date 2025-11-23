import mongoose from "mongoose";
//import tenantPlugin from "../util/tenantPlugin.js";

const ZoneSchema = mongoose.Schema({
    ZoneCode: {type: String, required: true, unique: true},
    ZoneName: {type: String, required: true},
    tenantId: {type: String, required: true, index: true},
});

// Apply the tenant plugin
//ZoneSchema.plugin(tenantPlugin);

const zoneModel = mongoose.model('Zone', ZoneSchema);
export default zoneModel;

