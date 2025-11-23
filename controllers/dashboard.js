import result from '../models/result.js';


const getRegistrationByExam = async (req, res) => {

  // write a aggregate on result collection to get the registration by exam
  // group by exam code and count the number of students
  // return the result as json
  try {
    const registrationByExam = await result.aggregate([
      {
        $match: {
          ExamCode: { $in: [ "AVIKSHA2025", "VA25" ] }
        }
      },
      {
        $group: {
          _id: "$ExamCode",
          count: { $sum: 1 }
        }
      }
    ]);
    res.status(200).json(registrationByExam);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

const getRegistrationBySchool = async (req, res) => {

  // write a aggregate on result collection to get the registration by school
  // group by school code and count the number of students
  // return the result as json
  try {
    const registrationBySchool = await result.aggregate([
      {
        $match: {
          ExamCode: { $in: [ "AVIKSHA2025", "VA25" ] }
        }
      },
      {
        $group: {
          _id: "$ExamCenterCode",
          count: { $sum: 1 }
        }
      },
      {
        $sort: {
          count: -1 // Sort by count in descending order
        }
      },
      {
        $limit: 50 // Limit the results to the top 10
      },
      {
        $lookup: {
          from: 'schools', // The collection to join
          localField: '_id', // Field from the input documents
          foreignField: 'DISECode', // Field from the documents of the "from" collection
          as: 'schoolInfo' // Output array field
        }
      },
      {
        $unwind: '$schoolInfo' // Deconstruct the array field from the previous stage
      },
      {
        $project: {
          count: 1,
          _id: { $substr: ["$schoolInfo.SchoolName", 0, 6] } // Include the SchoolName field from the joined collection
        }
      }
    ]);
    res.status(200).json(registrationBySchool);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
} 

const getRegistrationBySchoolAsc = async (req, res) => {

  // write a aggregate on result collection to get the registration by school
  // group by school code and count the number of students
  // return the result as json
  try {
    const registrationBySchool = await result.aggregate([
      {
        $match: {
          ExamCode: { $in: [ "AVIKSHA2025", "VA25" ] }
        }
      },
      {
        $group: {
          _id: "$ExamCenterCode",
          count: { $sum: 1 }
        }
      },
      {
        $sort: {
          count: 1 // Sort by count in descending order
        }
      },
      {
        $limit: 50 // Limit the results to the top 20
      },
      {
        $lookup: {
          from: 'schools', // The collection to join
          localField: '_id', // Field from the input documents
          foreignField: 'DISECode', // Field from the documents of the "from" collection
          as: 'schoolInfo' // Output array field
        }
      },
      {
        $unwind: '$schoolInfo' // Deconstruct the array field from the previous stage
      },
      {
        $project: {
          count: 1,
          _id: { $substr: ["$schoolInfo.SchoolName", 0, 6] } // Include the SchoolName field from the joined collection
        }
      }
    ]);
    res.status(200).json(registrationBySchool);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
} 

const getRegistrationByZone = async (req, res) => {

  // write a aggregate on result collection to get the registration by zone
  // group by zone code and count the number of students
  // return the result as json
  try {
    const registrationByZone = await result.aggregate([
      {
        $match: {
          ZoneCode: { $ne: "ZONE-UNDEFINED" },
          ExamCode: { $in: [ "AVIKSHA2025", "VA25" ] }
        }
      },
      {
        $group: {
          _id: "$ZoneCode",
          count: { $sum: 1 }
        }
      }
    ]);
    

    res.status(200).json(registrationByZone);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

const getParticipatingSchoolsByZone = async (req, res) => {

  // write a aggregate on result collection to get the registration by zone
  // group by zone code and count the number of students
  // return the result as json
  try {
    const schoolsByZone = await result.aggregate([
      {
        $match: {
          ZoneCode: { $ne: "ZONE-UNDEFINED" },
          ExamCode: { $in: [ "AVIKSHA2025", "VA25" ] }
        }
      },
      {
        $group: {
          _id: "$ZoneCode",
          uniqueSchools: { $addToSet: "$SchoolCode" } // Collect unique SchoolCode values
        }
      },
      {
        $project: {
          _id: 1,
          count: { $size: "$uniqueSchools" } // Count the number of unique schools
        }
      }
    ]);
    

    res.status(200).json(schoolsByZone);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

const getExamCentersByZone = async (req, res) => {

  // write a aggregate on result collection to get the registration by zone
  // group by zone code and count the number of students
  // return the result as json
  try {
    const examCenterByZone = await result.aggregate([
      {
        $match: {
          ZoneCode: { $ne: "ZONE-UNDEFINED" },
          ExamCode: { $in: [ "AVIKSHA2025", "VA25" ] }
        }
      },
      {
        $group: {
          _id: "$ZoneCode",
          uniqueSchools: { $addToSet: "$ExamCenterCode" } // Collect unique SchoolCode values
        }
      },
      {
        $project: {
          _id: 1,
          count: { $size: "$uniqueSchools" } // Count the number of unique schools
        }
      }
    ]);
    

    res.status(200).json(examCenterByZone);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

export { getRegistrationByExam, getRegistrationBySchool, getRegistrationByZone, 
  getRegistrationBySchoolAsc, getParticipatingSchoolsByZone, getExamCentersByZone };
