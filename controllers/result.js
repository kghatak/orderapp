
import result from '../models/result.js';
import processResult from '../util/processResult.js';
import studentModel from '../models/student.js';

const RomantoInt = (romanNumber) => {
    console.log("RomantoInt: " + romanNumber);
    var romanNumeral = romanNumber.toUpperCase(),
    
    lookup = {I:1,II:2,III:3,IV:4,V:5,VI:6,VII:7,VIII:8,IX:9,X:10, XI:11, XII:12};
    var arabicNumber = lookup[romanNumeral];
    
    console.log("RomantoInt: " + arabicNumber);
    return arabicNumber;

}

const getResultsForSchool = async (req, res) => {
    try {
        
        console.log("getResultsForSchool REQUEST REACHED");
        // print the params received in the request
        console.log(req.params);
        // create an empty object to store the params
        const schoolDataParams = {};

        // pritn the schoolCode received in the request
        // /:schoolCode/:zone/:class:/exam  
        console.log(req.params.schoolCode);

        // add schoolCode to the schoolDataParams object
        req.params.schoolCode? schoolDataParams.SchoolCode = req.params.schoolCode:null;
        req.params.zone? schoolDataParams.ZoneCode = req.params.zone:null;
        req.params.class? schoolDataParams.Class = req.params.class:null;
        req.params.exam? schoolDataParams.ExamCode = req.params.exam:null;
        
        console.log(schoolDataParams);

        //find resultList for schoolcode, class, zone and exam. ignore fields if not present in request body
        const resultList = await result.find(schoolDataParams, {});         
        
        res.status(200).json(resultList);

    } catch(error) {
        res.status(404).json({ message: error.message });
    }
}


const getResults = async (req, res) => {
    
    console.log(" ######### ->->getResults REQUEST REACHED");
    // DOnt Rerurn anything, just a success message
    res.status(200).json([]);

    // try {
    //     const resultList = await result.find({}, {});
    //     res.status(200).json(resultList);

    // } catch(error) {
    //     res.status(404).json({ message: error.message });
    // }
};

const getResultsJrGrade = async (req, res) => {
    try {
        const resultList = await result.find({ Class: { $lt: 6 } }, {});
        res.status(200).json(resultList);

    } catch(error) {
        res.status(404).json({ message: error.message });
    }
};

const getResultsMidGrade = async (req, res) => {
    try {
        const resultList = await result.find({ Class: { $gt: 5, $lt: 9 } }, {});
        res.status(200).json(resultList);

    } catch(error) {
        res.status(404).json({ message: error.message });
    }
};

const getExamCenterAndExamCode = async (req, res) => {
    // get uniq combination of ExamCenterCode and ExamCode and examCenterSchoolName and count of records
    try {
        const resultList = await result.aggregate([
            { $group: { _id: { ExamCenterCode: "$ExamCenterCode", ExamCode: "$ExamCode", ExamCenterSchoolName: "$ExamCenterSchoolName" }, count: { $sum: 1 } } },
            { $sort: { "_id.ExamCenterCode": 1, "_id.ExamCode": 1 } }
        ]);
        res.status(200).json(resultList);

    } catch(error) {
        res.status(404).json({ message: error.message });
    }
}

const getResultsSrGrade = async (req, res) => {
    try {
        const resultList = await result.find({ Class: { $gt: 8 } }, {});
        res.status(200).json(resultList);

    } catch(error) {
        res.status(404).json({ message: error.message });
    }
};

const getMerit = async (req, res) => {
    
    // Create a Json object with the following fields: StudentCode, ExamCode, Class, OverallPct, OverallGrade, OverallRank
    // Sort the Json object by OverallPct and OverallRank
        
    
    try {
        const resultList = await result.find({ Status: "APPROVED" }, {});
        res.status(200).json(resultList);

    } catch(error) {
        res.status(404).json({ message: error.message });
    }
};

// Update Overall Rank
const updateOverallRank = async (req, res) => {
    console.log("updateOverallRank REQUEST REACHED");
    res.status(200).json({ message: 'updateOverallRank' });
    // const resultitem = req.body;
    // const newResult = new result(resultitem);

    // try {
    //     // Check if the result already exists based on the StudentCode and ExamCode
    //     const existingResult = await result.findOne({ StudentCode: newResult.StudentCode, ExamCode: newResult.ExamCode });
        
    //   if (existingResult) {
    //     const updatedResult = await resutl.findOneAndUpdate({ "StudentCode" : req.params.id }, req.body, { new: true });
    //     res.status(200).json(updatedStudent);

    //   } else {
    //     // If the result does not exist, brak and throw an error
    //     console.error(error);
    //     res.status(500).json({ message: 'No Entry found for Examcode and StudentCode' + newResult.ExamCode + ":" + newResult.StudentCode });
    //   }
    // }
    // catch (error) {
    //     console.error(error);
    //     res.status(500).json({ message: 'An error occurred while updating the result' });
    // }
}


const createResult = async (req, res) => {
    //res.send('Reached the POST Server');
    console.log("createResult REQUEST REACHED");
    const resultitem = req.body; 
    const newResult = new result(resultitem);

    console.log(resultitem);
    console.log(newResult);

    try{
        await newResult.save();
        res.status(200).json(newResult);

    } catch( error ) {
        res.status(409).json({ message: error.message });
    }
}

const addRank = async (req, res) => {
   
    console.log("addRank REQUEST REACHED");
    // extract the StudentCode and ExamCode from the request params
    const { StudentCode, ExamCode } = req.params;
    console.log(StudentCode);
    console.log(ExamCode);

    // extract the rank from the request body
    const { OverallRank } = req.body;
    console.log(OverallRank);


    // find the result based on the StudentCode and ExamCode
    try{
        const existingResult = await result.findOne({ StudentCode: StudentCode, ExamCode: ExamCode });

        if (existingResult) {
            console.log("If the result already exists, update the result");
            console.log(existingResult);
            // update the OverallRank field based on StudentCode and ExamCode
            var newResult = new result(existingResult);
            newResult.OverallRank = OverallRank;
            console.log(newResult);
            const updatedResult = await result.findOneAndUpdate({ StudentCode: StudentCode, 
                                                                    ExamCode: ExamCode }, 
                                                                    newResult, { new: true });
            res.status(200).json(updatedResult);
        } else {
            // If the result does not exist, brak and throw an error
            console.error(error);
            res.status(500).json({ message: 'No Entry found for Examcode and StudentCode' + newResult.ExamCode + ":" + newResult.StudentCode });
        }

    } catch( error ) {
        res.status(409).json({ message: "Some Error calling DB" });
    }
   
}


const updateResult = async (req, res) => {
    console.log("updateResult REQUEST REACHED");
    const resultitem = req.body;
    console.log(resultitem);

    var newResult = new result(resultitem);
    console.log(newResult);
  
    try {
      // Check if the result already exists based on the StudentCode and ExamCode
      const existingResult = await result.findOne({ StudentCode: newResult.StudentCode, ExamCode: newResult.ExamCode });
    
      if (existingResult) {
        
        // If the result already exists, update the result
        var classNumber = existingResult.Class;
        newResult = processResult(newResult, classNumber);
        const updatedResult = await result.findOneAndUpdate({ StudentCode: newResult.StudentCode, ExamCode: newResult.ExamCode }, newResult, { new: true });
        res.status(200).json(updatedResult);

      } else {
        console.error(error);
        res.status(500).json({ message: 'No Entry found for Examcode and StudentCode' + newResult.ExamCode + ":" + newResult.StudentCode });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'An error occurred while updating the result' });
    }
  }


  const updateResultBulk = async (req, res) => {
    
    console.log("updateResultBulk REQUEST REACHED");
    const resultjson = req.body;

    console.log(resultjson);
  
    try {
      // Create an array of update operations
      const updateOperations = resultjson.map(async (resultRow) => {
        
        console.log(resultRow);
        // Check if the result already exists based on the StudentCode and ExamCode
        const id = resultRow.id;
        const arrayID = id.split(",");
        const StudentCode = arrayID[8];
        resultRow.StudentCode = StudentCode;
        console.log( resultRow )

        const ExamCode = arrayID[7];
        resultRow.ExamCode = ExamCode;
        
        const StudentName = arrayID[0];
        resultRow.StudentName = StudentName;
        
        const classNumber = arrayID[3];

        // check if a string is a number
        if(!isNaN(classNumber)) {
          console.log("classNumber is a number");
          resultRow.ClassNumber = Number(classNumber);
        } else {
            // check if a string is a Roman Numeral
            console.log("classNumber is a Roman Numeral");
            resultRow.ClassNumber = RomantoInt(classNumber);
        }

        console.log( resultRow );
        const existingResult = await result.findOne({ StudentCode: StudentCode, ExamCode: ExamCode });
  
        if (existingResult) {
          console.log("If the result already exists, update the result");
          //const classNumber = existingResult.Class;
          const processedResult = processResult(resultRow, resultRow.ClassNumber);

          console.log("processedResult");
          console.log(processedResult);

          return {
            updateOne: {
              filter: { StudentCode: processedResult.StudentCode, ExamCode: processedResult.ExamCode },
              update: processedResult,
              upsert: true,
            },
          };
        } else {
            // If the result does not exist, brak and throw an error
            console.log('No Entry found for Examcode and StudentCode' + ExamCode + ":" + StudentCode)
            res.status(500).json({ message: 'No Entry found for Examcode and StudentCode' + ExamCode + ":" + StudentCode });
        }
      });
  
      const updateResults = await Promise.all(updateOperations);

      console.log("updateResults");
      console.log(updateResults);
      // Update the results in bulk
      const resultUpdated = await result.bulkWrite(updateResults);
      res.status(200).json(resultUpdated);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'An error occurred while updating the results' });
    }
  }
  

// DeleteResult
const deleteResult = async (req, res) => {
    console.log("deleteResult REQUEST REACHED");
    const { StudentCode, ExamCode } = req.params;
    console.log("StudentCode:", StudentCode);
    console.log("ExamCode:", ExamCode);

    try {
        // Check if the result exists first
        const existingResult = await result.findOne({ StudentCode: StudentCode, ExamCode: ExamCode });
        
        if (!existingResult) {
            console.log("No result found for StudentCode:", StudentCode, "ExamCode:", ExamCode);
            return res.status(404).json({ 
                message: 'No result found for the given StudentCode and ExamCode',
                StudentCode: StudentCode,
                ExamCode: ExamCode
            });
        }

        // Delete the result
        const deletedResult = await result.findOneAndDelete({ StudentCode: StudentCode, ExamCode: ExamCode });
        console.log("---> DELETED!!!", deletedResult);
        
        res.status(200).json({ 
            message: 'Result deleted successfully',
            deletedResult: {
                StudentCode: deletedResult.StudentCode,
                ExamCode: deletedResult.ExamCode,
                StudentName: deletedResult.StudentName
            }
        });
    }
    catch (error) {
        console.error("Error in deleteResult:", error);
        res.status(500).json({ 
            message: 'An error occurred while deleting the result',
            error: error.message
        });
    }
}



import examModel from '../models/exam.js'; // Import the Exam model

const getResultByZoneAndSchoolCode = async (req, res) => {
    console.log("getResultByZoneAndSchoolCode REQUEST REACHED");

    // Extract parameters from the request
    const zonecode = req.params.zoneID;
    const schoolcode = req.params.schoolID;
    const schoolName = req.params.schoolName;
    const examCode = req.params.examCode;
    const tenantId = req.tenantId; // Assuming tenantId is available in the request

    console.log("Zone Code: " + zonecode);
    console.log("School Code: " + schoolcode);
    console.log("School Name: " + schoolName);
    console.log("Exam Code: " + examCode);
    console.log("Tenant ID: " + tenantId);

    // Prepare the schoolCodes array
    const schoolCodes = [schoolcode, `${schoolcode} / ${schoolName}`];
    console.log(schoolCodes);

    // Build the whereClause for the query
    let whereClause = {
        "ExamCode": examCode,
        "ExamCenterCode": { $in: schoolCodes }
    };

    if (!examCode || examCode === "null") {
        console.log("Return for all exams");
        delete whereClause["ExamCode"];
    }

    if (zonecode.includes("All Exam Centers")) {
        console.log("Return for all exam centers");
        whereClause = { ExamCode: req.defaultExamCode };
    }

    try {
        // Cache the Exam data
        console.log("Fetching Exam data for caching...");
        const examCache = {};
        const exams = await examModel.find({ tenantId }, { ExamCode: 1, ExamConductingDateString: 1, ExamConductingTimeString: 1, Organiser: 1, Description: 1 });
        exams.forEach((exam) => {
            examCache[exam.ExamCode] = {
                ExamConductingDateString: exam.ExamConductingDateString,
                ExamConductingTimeString: exam.ExamConductingTimeString,
                Organiser: exam.Organiser,
                Description: exam.Description
            };
        });
        console.log("Exam data cached:", examCache);

        // Fetch results based on the whereClause
        //let resultList = await result.find(whereClause).sort({ CreatedAt: -1 });

        let resultList = await result.aggregate([
            { $match: whereClause }, // Match the results based on the whereClause
            {
                $lookup: {
                    from: "students", // The name of the Student collection (case-sensitive)
                    localField: "StudentCode", // Field in the Result model
                    foreignField: "StudentCode", // Field in the Student model
                    as: "studentDetails" // The name of the array field to store joined data
                }
            },
            {
                $addFields: {
                    StudentPOCName: { $arrayElemAt: ["$studentDetails.StudentPOCName", 0] }, // Extract StudentPOCName
                    StudentPOCRelationship: { $arrayElemAt: ["$studentDetails.StudentPOCRelationship", 0] } // Extract StudentPOCRelationship
                }
            },
            { $project: { studentDetails: 0 } } // Optionally exclude the joined array
        ]);


        // Enrich results with cached Exam data
        resultList = resultList.map((resultItem) => {
            const plainResultItem = resultItem; // Convert to plain object
            const examData = examCache[resultItem.ExamCode];
            if (examData) {
                plainResultItem.ExamConductingDateString = examData.ExamConductingDateString;
                plainResultItem.ExamConductingTimeString = examData.ExamConductingTimeString;
                plainResultItem.Organiser = examData.Organiser;
                plainResultItem.ExamDescription = examData.Description;
            } else {
                console.log(`No cached exam data found for ExamCode: ${resultItem.ExamCode}`);
            }
            return plainResultItem;
        });

        // print first 5 results for debugging
        console.log("First 5 results after enrichment:", resultList.slice(0, 5));
        console.log("getResultByZoneAndSchoolCode --> RESPONDED");
        res.status(200).json(resultList);
    } catch (error) {
        console.error("Error in getResultByZoneAndSchoolCode:", error);
        res.status(404).json({ message: error.message });
    }
};

const getResultByRollNumber = async (req, res) => {
    const { rollNumber } = req.params;
    const tenantId = req.tenantId;

    try {
        // Trim and parse the roll number
        const trimmedRollNumber = rollNumber.replace(/\s+/g, '');
        const ExamRollNumber = trimmedRollNumber.slice(-4); // Extract last 4 characters
        const ExamRoll = trimmedRollNumber.slice(0, -4).replace(/[\s-]+$/, ''); // Extract the rest

        // Query the results collection
        const resultData = await result.findOne({
            tenantId: tenantId, // Matches the `tenantId` field
            ExamRoll: ExamRoll, // Matches the `ExamRoll` field
            ExamRollNumber: ExamRollNumber // Matches the `ExamRollNumber` field
        });

        
        if (resultData) {
            res.status(200).json(resultData);
        } else {
            res.status(404).json({ message: "Result not found for the given roll number" });
        }
    } catch (error) {
        res.status(500).json({ message: "An error occurred while fetching the result" });
    }
};

// export these methods
export { getResultByZoneAndSchoolCode, getResults, createResult, updateResult, updateResultBulk, 
            deleteResult, getResultsForSchool,
            getResultsJrGrade, getResultsMidGrade, getResultsSrGrade,
            getExamCenterAndExamCode, getMerit, addRank, getResultByRollNumber };
