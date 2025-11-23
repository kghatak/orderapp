let isRunning = true;

process.on('message', (data) => {
  if (data.command === 'stop-processing') {
    isRunning = false;
    process.send({ status: 'stopped' });
    process.exit(0);
  } else {
    console.log('Worker received initial data:', data);
    startProcessing(data);
  }
});

function startProcessing(initialData) {
  setInterval(async () => {
    if (!isRunning) return;

    console.log('Worker processing data:', initialData);

    // Perform your batch processing here
    await processStudentData(initialData);

    console.log('Batch job completed');
    process.send({ status: 'completed' });

    // Continue processing if still running
    if (isRunning) {
      process.send({ status: 'ready' });
    }
  }, 1000); // Wait for 1 second before processing again
}

async function processStudentData(data) {
  // Simulate a long-running task
  return new Promise((resolve) => {
    setTimeout(() => {
      console.log('Processed student data:', data);
      resolve();
    }, 5000); // Simulate a 5-second processing time
  });
}