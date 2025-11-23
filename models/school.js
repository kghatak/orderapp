import mongoose from "mongoose";


const SchoolSchema = mongoose.Schema({
    SchoolName: {type: String, required: true, unique: false},
    DISECode: {type: String, required: true, unique: true},
    SchoolShortName: {type: String, required: true, unique: true},
    ExamCenter: {type: Boolean, required: false, default: false},
    SchoolType: { type: String, required: true, enum: ['JR.HIGH( Upto Class VII)', 'PRIMARY', 'SSK', 'SEC & HS', 'MADRASHA', 'MSK' ] },
    ManagementType: {type: String, required: true, enum: ['GOVT. SPONSORED', 'PRIVATE', 'GOVT', 'GOVT. AIDED', 'MUNICIPAL']},
    ZoneCode: {type: String, required: false},
    ZoneName: {type: String, required: false},
    SchoolPOCName: {type: String, required: false},
    SchoolPOCPhoneNumber: {type: String, required: false},
    SchoolPOCEmailAddress: {type: String, required: false},
    Tags: {type: [String], required: false, default: []},
    //Exams: {type: [mongoose.Schema.Types.ObjectId], required: false, default: [], ref: 'Exam' },
    StudentCount: { type: Number, default: 0 },
    CreatedAt: { type: Date, default: new Date()},
    CreatedBy: { type: mongoose.Schema.Types.ObjectId},
    tenantId: {type: String, required: true, index: true},

});



const schoolModel = mongoose.model('School', SchoolSchema);
export default schoolModel;