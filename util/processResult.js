

const classToLevelMap = ['JR', 'JR', 'JR','JR','JR','JR', 
                         'MID', 'MID', 'MID', 
                         'SR', 'SR', 'SR', 'SR'];


function assignMaxScore(result, classLevel) {
  
  if(classLevel === 'JR') {
    result.NaturalScienceFullMarks = 40;
    result.MathematicsFullMarks = 30;
    result.ScienceTechDevFullMarks = 30;
  } else if (classLevel === 'MID') {
    result.MathematicsFullMarks = 25;
    result.ScienceTechDevFullMarks = 25;
    result.ScienceEnvironmentFullMarks = 50;
  } else if (classLevel === 'SR') {
    result.MathematicsFullMarks = 20;
    result.ScienceTechDevFullMarks = 20;
    result.PhysicalScienceFullMarks = 30;
    result.LifeScienceFullMarks = 30;
  } else {
    //
  }
  return result;
} 



function computeGradePercentage(result, classLevel) {
  
  var maxScore = 100;
  if (classLevel === 'JR') {

    if( result.NaturalScience > result.NaturalScienceFullMarks || 
        result.Mathematics > result.MathematicsFullMarks || 
        result.ScienceTechDev > result.ScienceTechDevFullMarks) {
      
        return null;
    }
    result.OverallScore = result.NaturalScience + result.Mathematics + result.ScienceTechDev;
    maxScore = result.NaturalScienceFullMarks 
                  + result.MathematicsFullMarks 
                  + result.ScienceTechDevFullMarks;

  } else if (classLevel === 'MID') {

    if( result.Mathematics > result.MathematicsFullMarks ||
        result.ScienceTechDev > result.ScienceTechDevFullMarks ||
        result.ScienceEnvironment > result.ScienceEnvironmentFullMarks) {
      
        return null
    }

    result.OverallScore = result.Mathematics + result.ScienceTechDev + result.ScienceEnvironment;
    maxScore = result.ScienceTechDevFullMarks 
                  + result.MathematicsFullMarks 
                  + result.ScienceEnvironmentFullMarks;

  } else if (classLevel === 'SR') {

    if( result.Mathematics > result.MathematicsFullMarks ||
        result.ScienceTechDev > result.ScienceTechDevFullMarks ||
        result.PhysicalScience > result.PhysicalScienceFullMarks ||
        result.LifeScience > result.LifeScienceFullMarks) {
      
        return null
    }

    result.OverallScore = result.Mathematics + result.ScienceTechDev + result.PhysicalScience + result.LifeScience;
    maxScore = result.ScienceTechDevFullMarks 
                  + result.MathematicsFullMarks 
                  + result.PhysicalScienceFullMarks
                  + result.LifeScienceFullMarks;
  } else {
    // Something Wrong
    console.log("### computeGradePercentage: Something Wrong");
    return null;
  }

  result.OverallPct = Math.round(( result.OverallScore / maxScore ) * 100, 2);

  
  if (result.OverallPct > 89.9 ) result.OverallGrade = 'A+';
  else if (result.OverallPct > 79.9 ) result.OverallGrade = 'A';
  else if (result.OverallPct > 69.9 ) result.OverallGrade = 'B+';
  else if (result.OverallPct > 59.9 ) result.OverallGrade = 'B';
  else if (result.OverallPct > 49.9 ) result.OverallGrade = 'C+';
  else if (result.OverallPct > 39.9 ) result.OverallGrade = 'C';
  else if (result.OverallPct > 32.9 ) result.OverallGrade = 'D+';
  else if (result.OverallPct > 24.9 ) result.OverallGrade = 'D';
  else result.OverallGrade = 'F'; 

  return result;
}

function updateResultStatus(result, status) {
  console.log("### updateResultStatus: " + status);
  result.ResultStatus = status;
  return result;
}

const  processResult = (result, classNumber) =>  {
  
  const classLevel  = classToLevelMap[classNumber];

  var updatedResultMaxScore = assignMaxScore(result, classLevel);
  var updatedResult = computeGradePercentage(updatedResultMaxScore, classLevel);
  
  if(updatedResult === null) {
    updatedResult = updateResultStatus(updatedResultMaxScore, 'ERROR UPDATING RESULT');
  } else {
    updatedResult = updateResultStatus(updatedResult, 'MARKS UPLOADED');
  }
  
  console.log("### processResult 2: " + updatedResult);

  return updatedResult;
}

export default processResult;
