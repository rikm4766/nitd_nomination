document.getElementById('nominationForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const form = e.target;
  const formData = new FormData(form);
  const submitBtn = document.getElementById('submitBtn');
  const loadingIndicator = document.getElementById('loadingIndicator');

  // Show loading indicator and disable submit button
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';
  loadingIndicator.style.display = 'block';

  try {
    const response = await fetch('/submit', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();

    if (response.ok) {
      alert('Nomination submitted successfully');
      form.reset();
      loadingIndicator.style.display = 'none';
      submitBtn.textContent = 'Submit Nomination';
      submitBtn.disabled = false;
    } else {
      alert('Submission failed: ' + result.error);
      // Re-enable the button on error
      loadingIndicator.style.display = 'none';
      submitBtn.textContent = 'Submit Nomination';
      submitBtn.disabled = false;
    }
  } catch (err) {
    alert('An error occurred while submitting the form.');
    console.error(err);
    // Re-enable the button on error
    loadingIndicator.style.display = 'none';
    submitBtn.textContent = 'Submit Nomination';
    submitBtn.disabled = false;
  }
});
