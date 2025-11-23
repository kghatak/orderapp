import mongoose from "mongoose";

const ExamSchema = mongoose.Schema({
    ExamName: {type: String, required: true},
    Description: {type: String, required: true},
    ExamType: {type: String, required: true},
    ExamStatus: {type: String, required: true},
    ExamCode: {type: String, required: true},
    RegistrationDate: {type: Date, default: new Date()},
    ResultDate: {type: Date, default: new Date()},
    CloseDate: {type: Date, default: new Date()},
    ExamConductingDateString: {type: String, required: true, default: "TBD"},
    ExamConductingTimeString: {type: String, required: true, default: "TBD"},
    Organiser: {type: String, required: true, default: "PASCHIM BANGA VIGYAN MANCHA X-JILLA DISTRICT COMMITTEE"},
    tenantId: {type: String, required: true, index: true},
});

// create a dummy json for exam
// {
//     "ExamName": "Exam 1",
//     "Description": "This is the first exam",
//     "ExamType": "MCQ",
//     "ExamStatus": "ACTIVE",
//     "ExamCode": "EXM0001"
//     "RegistrationDate": ""
//     "ResultDate": ""
//     "CloseDate": ""
// }

// create a composite index on examCode
ExamSchema.index({ ExamCode: 1, tenantId: 1 }, { unique: true });
const examModel = mongoose.model('Exam', ExamSchema);
export default examModel;