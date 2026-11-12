document.addEventListener('DOMContentLoaded', async function() {
    // Check if user is logged in as employer (server-backed when available)
    try {
        if (typeof refreshCurrentUser === 'function') await refreshCurrentUser();
    } catch {}
    const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    const role = user?.role || user?.type;
    if (!user || !(role === 'employer' || role === 'admin' || user?.type === 'employer')) {
        alert('You must be logged in as an employer to post jobs.');
        window.location.href = 'login.html';
        return;
    }

    // Form submission
    const form = document.getElementById('postJobForm');
    form.addEventListener('submit', handleSubmit);

    // Set minimum date to today
    const deadlineInput = document.getElementById('deadline');
    const today = new Date().toISOString().split('T')[0];
    deadlineInput.setAttribute('min', today);
});

function handleSubmit(e) {
    e.preventDefault();

    // Get form values
    const jobData = {
        title: document.getElementById('jobTitle').value,
        company: document.getElementById('company').value,
        category: document.getElementById('category').value,
        type: document.getElementById('jobType').value,
        location: document.getElementById('location').value,
        vacancies: document.getElementById('vacancies').value,
        description: document.getElementById('description').value,
        requirements: document.getElementById('requirements').value,
        deadline: document.getElementById('deadline').value,
        contactEmail: document.getElementById('contactEmail').value
    };

    // Validate deadline is in the future
    const deadlineDate = new Date(jobData.deadline);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (deadlineDate < today) {
        alert('Deadline must be in the future.');
        return;
    }

    // Submit to backend (direct employer submission, pending admin approval) with local fallback.
    (async () => {
        try {
            const user = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
            const res = await fetch('/api/employer/submit', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ ...jobData, submitterRef: user?.email || user?.company || null })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || data.error || 'Submission failed');
            const msg = document.querySelector('#successMessage p');
            if (msg) msg.textContent = data.message || 'Your vacancy was submitted and is pending administrator approval.';
        } catch (e) {
            // Fallback preserves existing local behavior when backend is unavailable.
            addJob(jobData);
            const msg = document.querySelector('#successMessage p');
            if (msg) msg.textContent = 'Backend unavailable: job saved locally on this device. Configure DATABASE_URL/Vercel API for shared publishing and admin approval.';
            console.warn(e);
        }
        document.getElementById('postJobForm').style.display = 'none';
        document.getElementById('successMessage').style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    })();
}
