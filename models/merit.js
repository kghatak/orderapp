import mongoose from "mongoose";

const MeritSchema = mongoose.Schema({
    _id: mongoose.Types.ObjectId, //// Added an _id field of type ObjectId for the unique identifier
    zone: {type: String, required: true},
    zoneCode: { type: String, required: true },
    examCentre: { type: String, required: true },
    schoolName: { type: String, required: true },
    examineeName: { type: String, required: true },
    rollNumber: { type: Number, required: true },
    class: { type: String, required: true },
    p_sc: { type: Number, required: true },
    i_sc: { type: Number, required: true },
    math: { type: Number, required: true },
    g_sc: { type: Number, required: true },
    total: { type: Number, required: true },
    grade: { type: String, required: true },
    position: { type: String, required: true },
    createdAt: { type: Date, default: new Date()},
});

// create a dummy json for merit
// {   
//     "Zone": "BINPUR 1",
//     "ZoneCode": "BIN1",
//     "ExamCentre": "KANTAPAHARI VIVEKANANDA VIDYAPITH",
//     "SchoolName": "SIJUA PRY. SCHOOL  ( BIN 1 )",
//     "ExamineeName": "LISHA PATRA",
//     "RollNumber": "0841",
//     "Class": "III",
//     "P_sc": 21,
//     "I_sc": 0,
//     "Math": 20,
//     "g_sc": 27,
//     "total": 68,
//     "grade": "A+",
//     "position": "1st"
//    }



const meritModel = mongoose.model('Merit', MeritSchema);
export default meritModel;