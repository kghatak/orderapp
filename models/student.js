import mongoose from "mongoose";

const StudentSchema = mongoose.Schema({
    StudentCode: {type: String, required: true, unique: true},
    FirstName: {type: String, required: true, unique: false},
    LastName: {type: String, required: true, unique: false},
    // Add gender to student schema with enum
    Gender: {type: String, required: true, enum: ['M', 'F', 'X'], default: 'F'},
    Caste: {type: String, required: true, enum: ['GEN', 'SC', 'ST', 'OBC', 'NA'], default: 'NA'},
    Class: {type: Number, required: true},
    //ClassRoman: {type: String, required: true, enum: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'], default: 'V'},
    SchoolCode: { type: String, required: true, unique: false },
    SchoolName: { type: String, required: true, unique: false },
    SchoolZoneCode: { type: String, required: false, unique: false },
    SchoolZoneName: { type: String, required: false, unique: false },
    
    // Will be updated during registration process.
    RecentExamCenterCode: {type: String, required: false},
    RecentExamCode: {type: String, required: false},
    RecentExamRollNumber: {type: String, required: false},
    RecentExamDate: {type: Date, required: false},
    RecentExamMeritListDate: {type: Date, required: false},


    StudentPOCName: {type: String, required: true, default: 'ADMIN'},
    StudentPOCPhoneNumber: {type: Number, required: true, default: 9775061538},
    StudentPOCEmail: {type: String, required: true, default: 'rupak.satpathi1@hotmail.com'},
    StudentPOCRelationship: {type: String, required: false, default: 'TEACHER'},
    CreatedAt: { type: Date, default: new Date()},
    //UpdatedAt: { type: Date, default: new Date()},
    CreatedBy: { type: String, required: true, default: 'ADMIN'},
    tenantId: {type: String, required: true, index: true},

});



const studentModel = mongoose.model('Student', StudentSchema);
export default studentModel;