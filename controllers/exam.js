import exam from '../models/exam.js'

// Helper function for tenant validation
const validateTenantId = (req, res) => {
    if (!req.tenantId) {
        res.status(400).json({ message: "Missing tenant ID in request" });
        return false;
    }
    return true;
};

var examListCache = [];

const getExams = async (req, res) => {
    console.log("getExams REQUEST REACHED");
    console.log("🔍 DEBUG: req.tenantId =", req.tenantId);
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    try {
        // Find all exams for the current tenant
        const examList = await exam.find({ "tenantId": req.tenantId });
        console.log(`Found ${examList.length} exams for tenant: ${req.tenantId}`);
        res.status(200).json(examList);

    } catch(error) {
        console.error("Error in getExams:", error);
        res.status(404).json({ message: error.message });
    }
};

const createExam = async (req, res) => {
    console.log("createExam REQUEST REACHED");
    console.log("🔍 DEBUG: req.tenantId =", req.tenantId);
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    const examitem = req.body; 
    
    // Validate required fields
    const { ExamName, Description, ExamType, ExamStatus, ExamCode } = examitem;
    if (!ExamName || !Description || !ExamType || !ExamStatus || !ExamCode) {
        return res.status(400).json({ 
            message: "ExamName, Description, ExamType, ExamStatus, and ExamCode are required fields" 
        });
    }

    // Add tenantId to exam data
    examitem.tenantId = req.tenantId;
    
    console.log("### Exam item with tenant:", examitem);

    // Check if exam with same ExamCode exists in this tenant
    try {
        const existingExam = await exam.findOne({ 
            "ExamCode": examitem.ExamCode,
            "tenantId": req.tenantId 
        });
        
        if(existingExam) {
            console.log("Exam with the same ExamCode exists for this tenant");
            return res.status(409).json({ 
                message: `Exam with ExamCode ${examitem.ExamCode} already exists in this tenant` 
            });
        }

        const newExam = new exam(examitem);
        console.log("### Saving Exam Data");

        await newExam.save();
        console.log(`Exam created for tenant ${req.tenantId}:`, newExam.ExamCode);
        res.status(201).json(newExam);

    } catch( error ) {
        console.error("Error occurred while saving exam:", error);
        res.status(409).json({ message: error.message + " - Save Error" });
    }    
};

const getExam = async (req, res) => {
    console.log("getExam REQUEST REACHED");
    console.log("🔍 DEBUG: req.tenantId =", req.tenantId);
    console.log("Exam Name:", req.params.id);
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    // Validate exam name
    if (!req.params.id) {
        return res.status(400).json({ message: "Exam name is required" });
    }
    
    try {
        const examData = await exam.findOne({ 
            "ExamName": req.params.id,
            "tenantId": req.tenantId 
        });
        
        if(examData) {
            res.status(200).json(examData);
        } else {
            res.status(404).json({ message: "Exam not found for this tenant" });
        }
    } catch(error) {
        console.error("Error in getExam:", error);
        res.status(404).json({ message: error.message });
    }
};

const updateExam = async (req, res) => {
    console.log("updateExam REQUEST REACHED");
    console.log("🔍 DEBUG: req.tenantId =", req.tenantId);
    console.log("Exam Name:", req.params.id);
    console.log("Update Data:", req.body);
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    // Validate exam name
    if (!req.params.id) {
        return res.status(400).json({ message: "Exam name is required" });
    }
    
    try {
        const examItem = await exam.findOne({ 
            "ExamName": req.params.id,
            "tenantId": req.tenantId 
        });
        
        if(examItem) {
            // Ensure tenantId cannot be changed in update
            const updateData = { ...req.body };
            delete updateData.tenantId;
            
            const updatedExam = await exam.findOneAndUpdate(
                { 
                    "ExamName": req.params.id,
                    "tenantId": req.tenantId 
                }, 
                updateData, 
                { new: true }
            );
            
            console.log(`Exam updated for tenant ${req.tenantId}:`, req.params.id);
            res.status(200).json(updatedExam);
        } else {
            res.status(404).json({ message: "Exam not found for this tenant" });
        }
    } catch(error) {
        console.error("Error in updateExam:", error);
        res.status(404).json({ message: error.message });
    }
};

const deleteExam = async (req, res) => {
    console.log("deleteExam REQUEST REACHED");
    console.log("🔍 DEBUG: req.tenantId =", req.tenantId);
    console.log("Exam Code:", req.params.id);
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    const examCodeToDelete = req.params.id;
    
    // Validate exam code
    if (!examCodeToDelete) {
        return res.status(400).json({ message: "Exam code is required" });
    }

    try {
        const deletedExam = await exam.findOneAndDelete({ 
            "ExamCode": examCodeToDelete,
            "tenantId": req.tenantId 
        });
        
        if (deletedExam) {
            console.log(`Exam deleted for tenant ${req.tenantId}:`, examCodeToDelete);
            res.status(200).json({ 
                message: "Exam deleted successfully",
                deletedExam: deletedExam 
            });
        } else {
            res.status(404).json({ message: "Exam not found for this tenant" });
        }
    } catch (error) {
        console.error("Error in deleteExam:", error);
        res.status(500).json({ message: error.message });
    }
};

// Bulk Import Exams via JSON Array
const bulkImportExamsJSON = async (req, res) => {
    console.log("## bulkImportExamsJSON REQUEST REACHED");
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    try {
        const { exams } = req.body;

        if (!exams || !Array.isArray(exams)) {
            return res.status(400).json({ 
                success: false,
                message: 'Request body must contain an "exams" array' 
            });
        }

        if (exams.length === 0) {
            return res.status(400).json({ 
                success: false,
                message: 'Exams array cannot be empty' 
            });
        }

        const results = {
            total: exams.length,
            successful: 0,
            failed: 0,
            errors: [],
            successfulExams: []
        };

        // Process each exam
        for (let i = 0; i < exams.length; i++) {
            const examData = exams[i];
            const rowNumber = i + 1;

            try {
                // Validate required fields
                if (!examData.ExamName || !examData.Description || !examData.ExamType || !examData.ExamStatus || !examData.ExamCode) {
                    results.errors.push({
                        row: rowNumber,
                        error: 'Missing required fields: ExamName, Description, ExamType, ExamStatus, ExamCode are required'
                    });
                    results.failed++;
                    continue;
                }

                // Validate ExamType
                if (!['MCQ', 'DESCRIPTIVE', 'MIXED', 'PRACTICAL'].includes(examData.ExamType)) {
                    results.errors.push({
                        row: rowNumber,
                        error: 'Invalid ExamType. Must be MCQ, DESCRIPTIVE, MIXED, or PRACTICAL'
                    });
                    results.failed++;
                    continue;
                }

                // Validate ExamStatus
                if (!['ACTIVE', 'INACTIVE', 'COMPLETED', 'CANCELLED'].includes(examData.ExamStatus)) {
                    results.errors.push({
                        row: rowNumber,
                        error: 'Invalid ExamStatus. Must be ACTIVE, INACTIVE, COMPLETED, or CANCELLED'
                    });
                    results.failed++;
                    continue;
                }

                // Check for duplicate exam (same ExamCode)
                const existingExam = await exam.findOne({ 
                    "ExamCode": examData.ExamCode,
                    "tenantId": req.tenantId 
                });

                if (existingExam) {
                    results.errors.push({
                        row: rowNumber,
                        error: `Exam with ExamCode ${examData.ExamCode} already exists in this tenant`
                    });
                    results.failed++;
                    continue;
                }

                // Prepare exam data
                const newExamData = {
                    ExamName: examData.ExamName.trim(),
                    Description: examData.Description.trim(),
                    ExamType: examData.ExamType,
                    ExamStatus: examData.ExamStatus,
                    ExamCode: examData.ExamCode.trim(),
                    RegistrationDate: examData.RegistrationDate ? new Date(examData.RegistrationDate) : new Date(),
                    ResultDate: examData.ResultDate ? new Date(examData.ResultDate) : new Date(),
                    CloseDate: examData.CloseDate ? new Date(examData.CloseDate) : new Date(),
                    tenantId: req.tenantId // Add tenant ID
                };

                // Save exam
                const savedExam = await exam.create(newExamData);

                results.successful++;
                results.successfulExams.push({
                    row: rowNumber,
                    examCode: examData.ExamCode,
                    examName: examData.ExamName,
                    fullExamData: savedExam // Include the complete exam object
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
            message: `Bulk import completed. ${results.successful} exams imported successfully, ${results.failed} failed.`,
            results: results,
            importedExams: results.successfulExams.map(item => item.fullExamData), // Array of complete exam objects
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

// Bulk Delete Exams
const bulkDeleteExams = async (req, res) => {
    console.log("## bulkDeleteExams REQUEST REACHED");
    
    // Validate tenant
    if (!validateTenantId(req, res)) return;
    
    try {
        const { examCodes } = req.body;

        if (!examCodes || !Array.isArray(examCodes)) {
            return res.status(400).json({ 
                success: false,
                message: 'Request body must contain an "examCodes" array' 
            });
        }

        if (examCodes.length === 0) {
            return res.status(400).json({ 
                success: false,
                message: 'Exam codes array cannot be empty' 
            });
        }

        const results = {
            total: examCodes.length,
            successful: 0,
            failed: 0,
            errors: [],
            deletedExams: []
        };

        // Process each exam deletion
        for (let i = 0; i < examCodes.length; i++) {
            const examCode = examCodes[i];
            const rowNumber = i + 1;

            try {
                console.log(`Checking exam code: ${examCode} for tenant: ${req.tenantId}`);
                // Check if exam exists for this tenant
                const existingExam = await exam.findOne({ 
                    "ExamCode": examCode,
                    "tenantId": req.tenantId 
                });
                
                if (!existingExam) {
                    results.errors.push({
                        row: rowNumber,
                        examCode: examCode,
                        error: 'Exam not found for this tenant'
                    });
                    results.failed++;
                    continue;
                }

                // Delete the exam
                await exam.findOneAndDelete({ 
                    "ExamCode": examCode,
                    "tenantId": req.tenantId 
                });

                results.successful++;
                results.deletedExams.push({
                    row: rowNumber,
                    examCode: examCode,
                    examName: existingExam.ExamName,
                    examType: existingExam.ExamType
                });

            } catch (error) {
                console.error(`Error deleting exam ${examCode}:`, error);
                results.errors.push({
                    row: rowNumber,
                    examCode: examCode,
                    error: error.message
                });
                results.failed++;
            }
        }

        // Send response
        res.status(200).json({
            success: results.successful > 0,
            message: `Bulk delete completed. ${results.successful} exams deleted successfully, ${results.failed} failed.`,
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
    getExam, getExams,
    createExam, updateExam,
    deleteExam, bulkImportExamsJSON, bulkDeleteExams
};