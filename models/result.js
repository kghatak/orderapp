import mongoose from "mongoose";

const ResultSchema = mongoose.Schema({
    StudentCode: {type: String, required: true},
    StudentName: {type: String, required: true},
    ExamCode: {type: String, required: true},
    ExamRoll: {type: String, required: true},
    ExamRollNumber: {type: String, required: true},
    YearOfExam: {type: String, required: false},
    SchoolCode: {type: String, required: true},
    SchoolName: {type: String, required: false},
    Class: {type: Number, required: false},
    ZoneCode: {type: String, required: false},
    ExamCenterCode: {type: String, required: false},
    ExamCenterSchoolName: {type: String, required: false},
    ResultStatus: {type: String, required: true, default: 'PENDING'},
    NaturalScience: {type: Number, required: true, default: 0},
    NaturalScienceFullMarks: {type: Number, required: true, default: 30},
    Mathematics: {type: Number, required: true, default: 0},
    MathematicsFullMarks: {type: Number, required: true, default: 30},
    ScienceTechDev: {type: Number, required: true, default: 0},
    ScienceTechDevFullMarks: {type: Number, required: true, default: 40},
    ScienceEnvironment: {type: Number, required: true, default: 0},
    ScienceEnvironmentFullMarks: {type: Number, required: true, default: 50},
    PhysicalScience: {type: Number, required: true, default: 0},
    PhysicalScienceFullMarks: {type: Number, required: true, default: 30},
    LifeScience: {type: Number, required: true, default: 0},
    LifeScienceFullMarks: {type: Number, required: true, default: 30},
    OverallScore: {type: Number, required: true, default: 0},
    OverallPct: {type: Number, required: true, default: 0},
    OverallGrade: {type: String, required: true, default: 'NA'},
    OverallRank: {type: String, required: false, default: 'NA'},
    Audited: {type: Boolean, required: false, default: false},
    AuditedBy: {type: String, required: false},
    CreatedAt: {type: Date, default: new Date()},
    tenantId: { type: String, required: false },

});

// create a composite index on StudentCode and ExamCode
ResultSchema.index({StudentCode: 1, ExamCode: 1}, {unique: true});


const resultModel = mongoose.model('Result', ResultSchema);
export default resultModel;