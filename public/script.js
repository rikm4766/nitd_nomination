document.getElementById('nominationForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const form = e.target;
  const formData = new FormData(form);

  try {
    const response = await fetch('/submit', {
      method: 'POST',
      body: formData
    });

    const result = await response.json();

    if (response.ok) {
      alert('Nomination submitted successfully');
      form.reset();
    } else {
      alert('Submission failed: ' + result.error);
    }
  } catch (err) {
    alert('An error occurred while submitting the form.');
    console.error(err);
  }
});
