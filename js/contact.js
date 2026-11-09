document.addEventListener('DOMContentLoaded', function() {
    // Form submission
    const form = document.getElementById('contactForm');
    form.addEventListener('submit', handleContactSubmit);
});

function handleContactSubmit(e) {
    e.preventDefault();

    // Get form values
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const subject = document.getElementById('subject').value;
    const message = document.getElementById('message').value;

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        alert('Please enter a valid email address.');
        return;
    }

    // In a real application, send this data to a server.
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

    // Show success message
    document.querySelector('.contact-form-section').innerHTML = `
        <div id="contactSuccess" class="success-message">
            <h3>✓ Message Sent!</h3>
            <p>Thank you for contacting us, ${esc(name)}. We'll get back to you soon at ${esc(email)}.</p>
            <button onclick="location.reload()" class="btn-primary">Send Another Message</button>
        </div>
    `;

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
