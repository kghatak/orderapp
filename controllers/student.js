import { Readable } from 'stream';
import  csv  from 'csv-parser';
import fs from 'fs';

import multer from 'multer';

import student from '../models/student.js'
import roll from '../models/roll.js'
import result from '../models/result.js'
import schoolModel from '../models/school.js';

var romanMap = null; 

// Helper function for tenant validation
const validateTenantId = (req, res) => {
    if (!req.tenantId) {
        res.status(400).json({ message: "Missing tenant ID in request" });
        return false;
    }
    return true;
};
    
const classRomantoNumber = (roman) => {
    // use a map to convert roman to number
    if ( romanMap == null ) {
        romanMap = new Map();
        romanMap.set('I', 1);
        romanMap.set('II', 2);
        romanMap.set('III', 3);
        romanMap.set('IV', 4);
        romanMap.set('V', 5);
        romanMap.set('VI', 6);
        romanMap.set('VII', 7);
        romanMap.set('VIII', 8);
        romanMap.set('IX', 9);
        romanMap.set('X', 10);
        romanMap.set('XI', 11);
        romanMap.set('XII', 12);
    }

    return romanMap.get(roman);
}

// This is a duplicate code. This is already present in controllers/roll.js Need to remove this.
const getStudentCode = async (studentCodePrefix, tenantId) => {
    const rollData = await roll.findOneAndUpdate(
        { "rollCode": studentCodePrefix, "tenantId": tenantId }, 
        { $inc: { maxRoll: 1 } },
        { new: true, upsert: true }
    );

    // concatenate all the three fields and return it as rollNumber
    const StudentCode = studentCodePrefix + rollData.maxRoll;
    console.log("New Student Code Generated: " + StudentCode);
    return StudentCode;
}

// This is a duplicate code. This is already present in controllers/roll.js Need to remove this.
const getRollNumberFromSchoolCode = async (schoolcode, tenantId) => {
    
    console.log("-------> getRollNumberFromSchoolCode REQUEST REACHED");
    console.log("Query Parameters:", { rollCode: schoolcode, tenantId });

    const rollData = await roll.findOneAndUpdate(
        { "rollCode": schoolcode, "tenantId": tenantId }, 
        { $inc: { maxRoll: 1 } },
        { new: true, upsert: true }
    );

    // concatenate all the three fields and return it as rollNumber
    const rollNumber = rollData.maxRoll;
    console.log("New Roll Number Generated: " + rollNumber);
    return rollNumber;
}

// Create in memory cache for DISECode --> SchoolShortName
var schoolShortNameCache = {};

const leftPadding = (num, size) => { 
    var s = num + "";
    while (s.length < size) s = "0" + s; 
    return s;
}

const assignRollNumberV2 = async (ZoneCode, ClassNumber, ExamYear, tenantId) => {
    const ExamRollSuffix = ZoneCode + ExamYear + leftPadding(ClassNumber.toString(),2);
    const ExamRollNumber = await getRollNumberFromSchoolCode(ExamRollSuffix + "-", tenantId);

    console.log("Exam Roll Number Generated: " + ExamRollNumber);

    const PaddedExamRollNumber = leftPadding(ExamRollNumber, 4);
    console.log("Padded Exam Roll Number: " + PaddedExamRollNumber);

    return { ExamRollSuffix, PaddedExamRollNumber };
}

const assignExamRollNumber = async (RecentExamCode, DISECode, classNumber, examYear, tenantId) => {
    var schoolShortName = '';
    console.log("assignExamRollNumber REQUEST REACHED");
    console.log("DISECode ****** " + DISECode);
    
    //first look at the cache schoolShortNameCache
    const cacheKey = `${DISECode}_${tenantId}`;
    if(schoolShortNameCache[cacheKey] != null && schoolShortNameCache[cacheKey] != undefined) {
        // get the schoolShortName from cache
        schoolShortName = schoolShortNameCache[cacheKey];
        console.log("School Short Name from Cache: " + schoolShortName);
    } else {
        // get the schoolShortName from DB with tenant filter
        const schoolData = await schoolModel.findOne({ 
            "DISECode": DISECode,
            "tenantId": tenantId 
        });
        if(schoolData) {
            schoolShortName = schoolData.SchoolShortName ?? 'UNK';
            // add the schoolShortName to cache with tenant context
            schoolShortNameCache[cacheKey] = schoolShortName;
            console.log("School Short Name Added to Cache" + schoolShortNameCache);
        } else {
            console.log("School Data Not Found for tenant");
        }
    }

    // here we should have the schoolShortName from cache or DB
    const ExamRollSuffix = schoolShortName + examYear + classNumber.toString();
    const ExamRoll = RecentExamCode + ":" + ExamRollSuffix;  
    const ExamRollNumber = await getRollNumberFromSchoolCode(ExamRoll + "-", tenantId);
    
    console.log("Exam Roll Number Generated: " + ExamRollSuffix);

    // Use the suffix to generate the ExamRoll.
    return { ExamRollSuffix, ExamRollNumber };
}

// getStudentsBySchoolCode
const getStudentsBySchoolCode = async (req, res) => {
    console.log("getStudentsBySchoolCode REQUEST REACHED");
    console.log("🔍 DEBUG: req.tenantId =", req.tenantId);
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    const schoolcode = req.params.id;
    console.log("School Code: " + schoolcode);

    // Validate school code
    if (!schoolcode) {
        return res.status(400).json({ message: "School code is required" });
    }

    try {
        // find all the students of a particular school with tenant filter
        const studentList = await student.find({ 
            "SchoolCode": schoolcode,
            "tenantId": req.tenantId 
        }).sort({ CreatedAt: -1 });
        
        console.log(`Found ${studentList.length} students for school ${schoolcode} and tenant: ${req.tenantId}`);
        res.status(200).json(studentList);
    } catch (error) {
        console.error("Error in getStudentsBySchoolCode:", error);
        res.status(404).json({ message: error.message });
    }
}

const getStudentsByZoneAndSchoolCode = async (req, res) => {
    console.log("getStudentsByZoneAndSchoolCode REQUEST REACHED");
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    const zonecode = req.params.zoneID;
    const schoolcode = req.params.schoolID;
    const classNumber = req.params.class;
    const examCode = req.params.examCode;

    console.log("Zone Code: " + zonecode);
    console.log("School Code: " + schoolcode);
    console.log("Class Number: " + classNumber);
    console.log("Exam Code: " + examCode);

    var whereClause = { 
        "SchoolZoneCode": zonecode,
        "Class": classNumber,
        "RecentExamCode": examCode,
        "SchoolCode": schoolcode,
        "tenantId": req.tenantId  // Always include tenant filter
    };

    if (classNumber == -1 || classNumber == null || classNumber == undefined || classNumber == "") {
        console.log("Return for all classes");
        delete whereClause["Class"];
    }

    if (schoolcode == "ALL SCHOOLS") {
        console.log("Return for all schools");
        delete whereClause["SchoolCode"];
    }

    if(schoolcode != "ALL SCHOOLS" || examCode == "ALL EXAMS" || examCode == undefined) {
        console.log("Return for all exams");
        delete whereClause["RecentExamCode"];
    } else if (examCode == "NO EXAMS" || examCode == "null") {
        console.log("Return for no exams");
        whereClause["RecentExamCode"] = null;
    }

    try {
        const studentList = await student.find(whereClause).sort({ CreatedAt: -1 });
        console.log(`Found ${studentList.length} students for tenant: ${req.tenantId}`);
        res.status(200).json(studentList);
    } catch (error) {
        console.error("Error in getStudentsByZoneAndSchoolCode:", error);
        res.status(404).json({ message: error.message });
    }
}

const getStudents = async (req, res) => {
    console.log("getStudents REQUEST REACHED");
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    // For now, respond with empty array as per original logic
    // but you could implement filtered search here
    res.status(200).json([]);
};

const createStudent = async (req, res) => {
    console.log("createStudent REQUEST REACHED");
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    var Studentitem = req.body;
    
    // Validate required fields
    const { FirstName, LastName, SchoolCode, Class } = Studentitem;
    if (!FirstName || !LastName || !SchoolCode || !Class) {
        return res.status(400).json({ 
            message: "FirstName, LastName, SchoolCode, and Class are required fields" 
        });
    }

    // Add tenantId to student data
    Studentitem.tenantId = req.tenantId;
    
    Studentitem["Class"] = classRomantoNumber(Studentitem.Class);
    
    console.log("### Student item with tenant:", Studentitem);

    // check if AllowDuplicateName is true
    if(!Studentitem.AllowDuplicateName || Studentitem.AllowDuplicateName === false) {
        // check if the student with the same name exists in this tenant
        console.log("Check IF Student with the same name exists");
        
        const existingStudent = await student.findOne({ 
            "FirstName": Studentitem.FirstName, 
            "LastName": Studentitem.LastName,
            "SchoolCode": Studentitem.SchoolCode,
            "Class": Studentitem.Class,
            "tenantId": req.tenantId 
        });
        
        if(existingStudent) {
            console.log("Student with the same name exists for this tenant");
            return res.status(409).json({ 
                message: `Student with the name ${Studentitem.FirstName} ${Studentitem.LastName} exists in this tenant` 
            });
        }
    }

    console.log(Studentitem.AllowDuplicateName);
    const ZoneCode = Studentitem.SchoolZoneCode ?? 'TEMP';
    const prefix = ZoneCode.concat("2025").concat(Studentitem.Class).concat(Studentitem.Gender);
    console.log(prefix);
    Studentitem.StudentCode = await getStudentCode(prefix, req.tenantId);
    
    const now = new Date();
    const currentTime = now.getTime();
    console.log(currentTime);
    Studentitem.CreatedAt = currentTime;

    console.log("Student item with tenant:", Studentitem);
    
    try {
        console.log("### Saving Student Data");
        const newStudent = await student.create(Studentitem);
        console.log(`Student created for tenant ${req.tenantId}:`, newStudent.StudentCode);
        res.status(201).json(newStudent);

    } catch(error) {
        console.error("Error occurred while saving student:", error);
        res.status(409).json({ message: error.message + " - Save Error" });
    }
};

const getStudent = async (req, res) => {
    console.log("getStudent REQUEST REACHED");
    console.log(req.params.id);
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    // Validate student ID
    if (!req.params.id) {
        return res.status(400).json({ message: "Student ID is required" });
    }

    try {
        const StudentData = await student.findOne({ 
            "StudentCode": req.params.id,
            "tenantId": req.tenantId 
        });
        
        if(StudentData) {
            res.status(200).json(StudentData);
        } else {
            res.status(404).json({ message: "Student not found for this tenant" });
        }
    } catch(error) {
        console.error("Error in getStudent:", error);
        res.status(404).json({ message: error.message });
    }
};

const updateStudent = async (req, res) => {
    console.log("updateStudent REQUEST REACHED");
    console.log(req.params.id);
    console.log(req.body);
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    // Validate student ID
    if (!req.params.id) {
        return res.status(400).json({ message: "Student ID is required" });
    }

    try {
        const StudentData = await student.findOne({ 
            "StudentCode": req.params.id,
            "tenantId": req.tenantId 
        });
        
        if(StudentData) {
            // Ensure tenantId cannot be changed in update
            const updateData = { ...req.body };
            delete updateData.tenantId;
            
            const updatedStudent = await student.findOneAndUpdate(
                { 
                    "StudentCode": req.params.id,
                    "tenantId": req.tenantId 
                }, 
                updateData, 
                { new: true }
            );
            
            if(req.body.UpdateRegistration) {
                var updatedStudentData = {};
                updatedStudentData.StudentCode = updatedStudent.StudentCode;
                updatedStudentData.StudentName = updatedStudent.FirstName + " " + updatedStudent.LastName;
                updatedStudentData.Class = updatedStudent.Class;

                console.log(updatedStudentData);

                // update All result data for this student within the same tenant
                const resultData = await result.find({ 
                    "StudentCode": req.params.id,
                    "tenantId": req.tenantId 
                });
                
                for(const resData of resultData) {
                    console.log("Updating ....\n" + resData);
                    resData.StudentName = updatedStudentData.StudentName;
                    resData.Class = updatedStudentData.Class;
                    await resData.save();
                }
            } else {
                console.log("NOT UPDATING REGISTRATION");
            }

            console.log(`Student updated for tenant ${req.tenantId}:`, req.params.id);
            res.status(200).json(updatedStudent);
        } else {
            res.status(404).json({ message: "Student not found for this tenant" });
        }
    } catch(error) {
        console.error("Error in updateStudent:", error);
        res.status(404).json({ message: error.message });
    }
};

const registerStudent = async (req, res) => {
    console.log("Register Student REQUEST REACHED");
    console.log(req.params.id);
    console.log(req.body);
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    // Validate student ID
    if (!req.params.id) {
        return res.status(400).json({ message: "Student ID is required" });
    }

    const RecentExamCenterCode = req.body.RecentExamCenterCode;
    const RecentExamCenterSchoolName = req.body.ExamCenterSchoolName;
    const RecentExamZoneCode = req.body.RecentExamZoneCode;
    
    try {
        const resultData = await result.findOne({ 
            "StudentCode": req.params.id, 
            "ExamCode": req.body.RecentExamCode,
            "tenantId": req.tenantId 
        });
        
        if(resultData != null) {
            const StudentDataForExam = await student.findOne({ 
                "StudentCode": req.params.id,
                "tenantId": req.tenantId 
            });
            
            if(StudentDataForExam) {
                console.log("**** Student Already Registered for this Exam");
                // Update the resultData with the new ExamCenterCode and ExamCenterSchoolName
                resultData.ExamCenterCode = RecentExamCenterCode;
                resultData.ExamCenterSchoolName = RecentExamCenterSchoolName;
                resultData.ZoneCode = RecentExamZoneCode;
                resultData.ExamStatus = "Registration";
                resultData.ExamName = req.body.RecentExamCode;
                resultData.ExamYear = "2025";
                resultData.ExamDate = new Date();
                resultData.ResultStatus = "PENDING";
                resultData.OverallRank = "NA";
                resultData.Class = StudentDataForExam.Class;
                resultData.SchoolCode = StudentDataForExam.SchoolCode;
                resultData.SchoolName = StudentDataForExam.SchoolName;
                resultData.ZoneCode = StudentDataForExam.SchoolZoneCode;
                resultData.Audited = false;

                console.log("RESULTDATA ABOUT TO SAVE --->>>> ");
                console.log(resultData);
                
                await resultData.save();
                res.status(200).json({ message: "Student Already Registered for this Exam. Updated data" });
            } else {
                res.status(404).json({ message: "Student not found for this tenant" });
            }
        } else {
            const StudentData = await student.findOne({ 
                "StudentCode": req.params.id,
                "tenantId": req.tenantId 
            });
            
            if(StudentData) {
                console.log("**** Student Found--> Now Start the Registration Process");
                console.log(StudentData);
                if(StudentData.RecentExamCode != null) {
                    console.log("Student Already Registered for an Exam");
                    return res.status(409).json({ message: "Student Already Registered for an Exam" });
                } else {
                    var ResultData = {};
                    console.log(ResultData);
                    ResultData.StudentCode = req.params.id;
                    ResultData.StudentName = StudentData.FirstName + " " + StudentData.LastName;
                    ResultData.SchoolName = StudentData.SchoolName;
                    ResultData.tenantId = req.tenantId; // Add tenant ID to result
                    
                    console.log(ResultData);
                    ResultData.ExamCode = req.body.RecentExamCode;
                    console.log(ResultData);
                    ResultData.SchoolCode = StudentData.SchoolCode;
                
                    ResultData.ExamCenterCode = RecentExamCenterCode;
                    ResultData.ExamCenterSchoolName = RecentExamCenterSchoolName;
                    ResultData.ZoneCode = RecentExamZoneCode;
                    
                    console.log("HERE....");
                    ResultData.ExamCenterCode = req.body.RecentExamCenterCode;
                    ResultData.ExamStatus = "Registration";
                    ResultData.ExamName = req.body.RecentExamCode;
                    ResultData.ExamYear = "2025";
                    console.log("HERE....2 ***");
                    console.log(ResultData);
                    
                    console.log("Basic Json Created" + ResultData);
                    const { ExamRollSuffix, PaddedExamRollNumber } = await assignRollNumberV2(
                        RecentExamZoneCode, 
                        StudentData.Class,
                        "25",
                        req.tenantId
                    );
                
                    console.log("Exam Roll Number Generated: " + PaddedExamRollNumber);
                    console.log("Exam Roll : " + ExamRollSuffix);

                    ResultData.ExamRoll = ExamRollSuffix;
                    ResultData.ExamRollNumber = PaddedExamRollNumber;
                    ResultData.ResultStatus = "PENDING";
                    ResultData.OverallRank = "NA";
                    ResultData.Audited = false;
                    ResultData.Class = StudentData.Class;
                    
                    console.log(ResultData);

                    const newResult = await result.create(ResultData);
                    
                    // Ensure tenantId cannot be changed in update
                    const updateData = { ...req.body };
                    delete updateData.tenantId;
                    
                    const updatedStudent = await student.findOneAndUpdate(
                        { 
                            "StudentCode": req.params.id,
                            "tenantId": req.tenantId 
                        }, 
                        updateData, 
                        { new: true }
                    );

                    res.status(200).json(updatedStudent);
                }
            } else {
                res.status(404).json({ message: "Student not found for this tenant" });
            }
        }
    } catch(error) {
        console.error("Error in registerStudent:", error);
        res.status(404).json({ message: error.message });
    }
};


// Remove Registration Function
const removeRegistration = async (req, res) => {
    console.log("Remove Registration REQUEST REACHED");
    console.log("StudentCode:", req.params.id);
    console.log("Request body:", req.body);

    const { RecentExamCode } = req.body;

    try {
        // First check if the student exists
        const StudentData = await student.findOne({ "StudentCode": req.params.id });
        if (!StudentData) {
            console.log("Student not found:", req.params.id);

            // Need to clean up Results if there is no students. 
            // The Student is deleted from the Students Table before.
            await result.deleteMany({ "StudentCode": req.params.id });

            return res.status(200).json({ 
                message: "Student not found: Deleted any associated results",
                StudentCode: req.params.id
            });
        }
        
        console.log("Student found:", StudentData.FirstName + " " + StudentData.LastName);
        console.log("Student's RecentExamCode:", StudentData.RecentExamCode);
        
        // Check if the result exists for this student and exam
        const resultData = await result.findOne({ 
            "StudentCode": req.params.id, 
            "ExamCode": RecentExamCode 
        });

        if (resultData == null) {
            console.log("No registration found for this student and exam");
            
            // Let's check what results exist for this student to help debug
            const allResultsForStudent = await result.find({ "StudentCode": req.params.id });
            console.log("All results for this student:", allResultsForStudent);
            
            return res.status(404).json({ 
                message: "No registration found for this student and exam",
                StudentCode: req.params.id,
                ExamCode: RecentExamCode,
                availableResults: allResultsForStudent.map(r => ({ 
                    ExamCode: r.ExamCode, 
                    StudentName: r.StudentName,
                    ExamStatus: r.ExamStatus 
                }))
            });
        }

        // Student data already retrieved above

        console.log("**** Removing Registration for Student:", StudentData.FirstName + " " + StudentData.LastName);
        console.log("**** Exam Code:", RecentExamCode);

        // Delete the result record
        const deletedResult = await result.findOneAndDelete({ 
            "StudentCode": req.params.id, 
            "ExamCode": RecentExamCode 
        });

        console.log("Result record deleted:", deletedResult);

        // Clear the RecentExamCode and related fields from student record
        const updateData = {
            RecentExamCode: null,
            RecentExamCenterCode: null,
            ExamCenterSchoolName: null,
            RecentExamZoneCode: null
        };

        const updatedStudent = await student.findOneAndUpdate(
            { "StudentCode": req.params.id }, 
            updateData, 
            { new: true }
        );

        console.log("Student record updated:", updatedStudent);

        res.status(200).json({ 
            message: "Registration removed successfully",
            student: updatedStudent,
            deletedResult: {
                StudentCode: deletedResult.StudentCode,
                ExamCode: deletedResult.ExamCode,
                StudentName: deletedResult.StudentName,
                ExamRoll: deletedResult.ExamRoll
            }
        });

    } catch (error) {
        console.error("Error in removeRegistration:", error);
        res.status(500).json({ 
            message: "Failed to remove registration",
            error: error.message 
        });
    }
};
const deleteStudent = async (req, res) => {
    console.log("deleteStudent REQUEST REACHED");
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    const studentCodeToDelete = req.params.id;
    
    // Validate student ID
    if (!studentCodeToDelete) {
        return res.status(400).json({ message: "Student ID is required" });
    }

    try {
        const deletedStudent = await student.findOneAndDelete({ 
            "StudentCode": studentCodeToDelete,
            "tenantId": req.tenantId 
        });
        
        if (deletedStudent) {
            console.log(`Student deleted for tenant ${req.tenantId}:`, studentCodeToDelete);
            res.status(200).json({ 
                message: "Student deleted successfully",
                deletedStudent: deletedStudent 
            });
        } else {
            res.status(404).json({ message: "Student not found for this tenant" });
        }
    } catch (error) {
        console.error("Error in deleteStudent:", error);
        res.status(500).json({ message: error.message });
    }
};

const updateStudentClass = async (req, res) => {
    console.log("updateStudentClass REQUEST REACHED");
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    const updates = req.body; // Array of { studentCode, newClass } pairs

    if (!Array.isArray(updates)) {
        return res.status(400).json({ message: "Request body must be an array of updates" });
    }
    
    try {
        // Prepare an array to store updated student objects
        const updatedStudents = [];
  
        // Iterate through each update
        for(const updateElement of updates) {
            console.log(`Updating student ${updateElement.StudentCode} to class ${updateElement.Class}`);
            
            // Find the student by StudentCode within tenant
            const studentData = await student.findOne({ 
                "StudentCode": updateElement.StudentCode,
                "tenantId": req.tenantId 
            });
            
            if (studentData) {
                console.log("Student found:", updateElement);

                studentData.Class = classRomantoNumber(updateElement.Class);
                studentData.SchoolCode = updateElement.SchoolCode;
                studentData.SchoolName = updateElement.SchoolName;
                studentData.SchoolZoneCode = updateElement.SchoolZoneCode;
                studentData.RecentExamCenterCode = null;
                studentData.RecentExamCode = null;
                studentData.RecentExamRollNumber = null;
                studentData.RecentExamDate = null;
                studentData.RecentExamMeritListDate = null;
                studentData.CreatedAt = new Date();
                studentData.CreatedBy = "ADMIN";

                await studentData.save();
                console.log("Student class updated:", studentData);
                // Push updated student to array
                updatedStudents.push(studentData);
            } else {
                console.log(`Student with code ${updateElement.StudentCode} not found for tenant ${req.tenantId}`);
                return res.status(404).json({ 
                    message: `Student with code ${updateElement.StudentCode} not found for this tenant` 
                });
            }
        }
  
        // Respond with success and updated students
        res.status(200).json({ 
            message: "Batch update successful", 
            students: updatedStudents,
            tenantId: req.tenantId 
        });
    } catch (error) {
        console.error("Error updating student classes:", error.message);
        res.status(500).json({ message: error.message });
    }
};

// Bulk Import Students via JSON Array
const bulkImportStudentsJSON = async (req, res) => {
    console.log("## bulkImportStudentsJSON REQUEST REACHED");
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    try {
        const { students } = req.body;

        if (!students || !Array.isArray(students)) {
            return res.status(400).json({ 
                success: false,
                message: 'Request body must contain a "students" array' 
            });
        }

        if (students.length === 0) {
            return res.status(400).json({ 
                success: false,
                message: 'Students array cannot be empty' 
            });
        }

        const results = {
            total: students.length,
            successful: 0,
            failed: 0,
            errors: [],
            successfulStudents: []
        };

        // Process each student
        for (let i = 0; i < students.length; i++) {
            const studentData = students[i];
            const rowNumber = i + 1;

            try {
                // Validate required fields
                if (!studentData.FirstName || !studentData.LastName || !studentData.SchoolCode || !studentData.SchoolName) {
                    results.errors.push({
                        row: rowNumber,
                        error: 'Missing required fields: FirstName, LastName, SchoolCode, SchoolName are required'
                    });
                    results.failed++;
                    continue;
                }

                // Validate Gender
                if (!['M', 'F', 'X'].includes(studentData.Gender)) {
                    results.errors.push({
                        row: rowNumber,
                        error: 'Invalid Gender. Must be M, F, or X'
                    });
                    results.failed++;
                    continue;
                }

                // Validate Caste
                if (!['GEN', 'SC', 'ST', 'OBC', 'NA'].includes(studentData.Caste)) {
                    results.errors.push({
                        row: rowNumber,
                        error: 'Invalid Caste. Must be GEN, SC, ST, OBC, or NA'
                    });
                    results.failed++;
                    continue;
                }

                // Validate Class (convert Roman to number if needed)
                let classNumber;
                if (typeof studentData.Class === 'string') {
                    classNumber = classRomantoNumber(studentData.Class);
                    if (!classNumber) {
                        results.errors.push({
                            row: rowNumber,
                            error: 'Invalid Class. Must be a number (1-12) or Roman numeral (I-XII)'
                        });
                        results.failed++;
                        continue;
                    }
                } else {
                    classNumber = parseInt(studentData.Class);
                    if (isNaN(classNumber) || classNumber < 1 || classNumber > 12) {
                        results.errors.push({
                            row: rowNumber,
                            error: 'Invalid Class. Must be between 1 and 12'
                        });
                        results.failed++;
                        continue;
                    }
                }

                // Check for duplicate student (same name, school, and class) - only if AllowDuplicateName is false
                if (!studentData.AllowDuplicateName) {
                    const existingStudent = await student.findOne({ 
                        "FirstName": studentData.FirstName, 
                        "LastName": studentData.LastName,
                        "SchoolCode": studentData.SchoolCode,
                        "Class": classNumber,
                        "tenantId": req.tenantId 
                    });

                    if (existingStudent) {
                        results.errors.push({
                            row: rowNumber,
                            error: `Student with name ${studentData.FirstName} ${studentData.LastName} already exists in this school and class for this tenant`
                        });
                        results.failed++;
                        continue;
                    }
                }

                // Generate Student Code
                const zoneCode = studentData.SchoolZoneCode || 'TEMP';
                const prefix = zoneCode.concat("2025").concat(classNumber).concat(studentData.Gender);
                const studentCode = await getStudentCode(prefix, req.tenantId);

                // Prepare student data
                const newStudentData = {
                    StudentCode: studentCode,
                    FirstName: studentData.FirstName.trim(),
                    LastName: studentData.LastName.trim(),
                    Gender: studentData.Gender,
                    Caste: studentData.Caste,
                    Class: classNumber,
                    SchoolCode: studentData.SchoolCode.trim(),
                    SchoolName: studentData.SchoolName.trim(),
                    SchoolZoneCode: studentData.SchoolZoneCode || null,
                    SchoolZoneName: studentData.SchoolZoneName || null,
                    StudentPOCName: studentData.StudentPOCName || 'ADMIN',
                    StudentPOCPhoneNumber: studentData.StudentPOCPhoneNumber || 9775061538,
                    StudentPOCEmail: studentData.StudentPOCEmail || 'rupak.satpathi1@hotmail.com',
                    StudentPOCRelationship: studentData.StudentPOCRelationship || 'TEACHER',
                    CreatedAt: new Date(),
                    CreatedBy: studentData.CreatedBy || 'ADMIN',
                    tenantId: req.tenantId // Add tenant ID
                };

                // Save student
                const savedStudent = await student.create(newStudentData);

                results.successful++;
                results.successfulStudents.push({
                    row: rowNumber,
                    studentCode: studentCode,
                    name: `${studentData.FirstName} ${studentData.LastName}`,
                    school: studentData.SchoolName,
                    fullStudentData: savedStudent // Include the complete student object
                });

            } catch (error) {
                console.error(`Error processing row ${rowNumber}:`, error);
                results.errors.push({
                    row: rowNumber,
                    error: error.message
                });
                results.failed++;
            }
        }

        // Send response
        res.status(200).json({
            success: true,
            message: `Bulk import completed. ${results.successful} students imported successfully, ${results.failed} failed.`,
            results: results,
            importedStudents: results.successfulStudents.map(item => item.fullStudentData), // Array of complete student objects
            summary: {
                total: results.total,
                successful: results.successful,
                failed: results.failed
            },
            tenantId: req.tenantId
        });

    } catch (error) {
        console.error('Bulk import error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Internal server error: ' + error.message 
        });
    }
};

// Bulk Delete Students
const bulkDeleteStudents = async (req, res) => {
    console.log("## bulkDeleteStudents REQUEST REACHED");
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    try {
        const { studentCodes } = req.body;

        if (!studentCodes || !Array.isArray(studentCodes)) {
            return res.status(400).json({ 
                success: false,
                message: 'Request body must contain a "studentCodes" array' 
            });
        }

        if (studentCodes.length === 0) {
            return res.status(400).json({ 
                success: false,
                message: 'Student codes array cannot be empty' 
            });
        }

        // Debug: Check what students exist in database for this tenant
        console.log('Requested student codes:', studentCodes);
        const allStudents = await student.find(
            { tenantId: req.tenantId }, 
            { StudentCode: 1, FirstName: 1, LastName: 1 }
        );
        console.log('Available students in database for tenant:', allStudents.map(s => s.StudentCode));

        const results = {
            total: studentCodes.length,
            successful: 0,
            failed: 0,
            errors: [],
            deletedStudents: []
        };

        // Process each student deletion
        for (let i = 0; i < studentCodes.length; i++) {
            const studentCode = studentCodes[i];
            const rowNumber = i + 1;

            try {
                console.log(`Checking student code: ${studentCode} for tenant: ${req.tenantId}`);
                // Check if student exists for this tenant
                const existingStudent = await student.findOne({ 
                    "StudentCode": studentCode,
                    "tenantId": req.tenantId 
                });
                
                if (!existingStudent) {
                    results.errors.push({
                        row: rowNumber,
                        studentCode: studentCode,
                        error: 'Student not found for this tenant'
                    });
                    results.failed++;
                    continue;
                }

                // Delete the student
                await student.findOneAndDelete({ 
                    "StudentCode": studentCode,
                    "tenantId": req.tenantId 
                });

                results.successful++;
                results.deletedStudents.push({
                    row: rowNumber,
                    studentCode: studentCode,
                    name: `${existingStudent.FirstName} ${existingStudent.LastName}`,
                    school: existingStudent.SchoolName,
                    class: existingStudent.Class
                });

            } catch (error) {
                console.error(`Error deleting student ${studentCode}:`, error);
                results.errors.push({
                    row: rowNumber,
                    studentCode: studentCode,
                    error: error.message
                });
                results.failed++;
            }
        }

        // Send response
        res.status(200).json({
            success: results.successful > 0,
            message: `Bulk delete completed. ${results.successful} students deleted successfully, ${results.failed} failed.`,
            results: results,
            summary: {
                total: results.total,
                successful: results.successful,
                failed: results.failed
            },
            tenantId: req.tenantId
        });

    } catch (error) {
        console.error('Bulk delete error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Internal server error: ' + error.message 
        });
    }
};

export {
    getStudent, getStudents,
    createStudent, updateStudent, updateStudentClass,
    deleteStudent, registerStudent, removeRegistration,
    getStudentsBySchoolCode,
    getStudentsByZoneAndSchoolCode, bulkImportStudentsJSON, bulkDeleteStudents
};