// Authentication system

// Initialize users in localStorage
function initUsers() {
    if (!localStorage.getItem('users')) {
        const defaultUsers = {
            jobseekers: [
                { email: 'jobseeker@test.com', password: 'password123', name: 'Test Job Seeker', phone: '0911234567' }
            ],
            employers: [
                { email: 'employer@test.com', password: 'password123', company: 'Test Company', contactName: 'Test Employer', phone: '0911234567' }
            ]
        };
        localStorage.setItem('users', JSON.stringify(defaultUsers));
    }
}

initUsers();

// Check if user is logged in
function isLoggedIn() {
    return localStorage.getItem('currentUser') !== null;
}

// Get current user
function getCurrentUser() {
    const user = localStorage.getItem('currentUser');
    return user ? JSON.parse(user) : null;
}

// Logout
function logout() {
    localStorage.removeItem('currentUser');
    window.location.href = 'index.html';
}

// Update navigation based on login status
function updateNavigation() {
    const user = getCurrentUser();
    
    // Use the updateNavbar function from main.js if available
    if (typeof updateNavbar === 'function') {
        updateNavbar();
    }
    
    // Update Post Job link visibility
    const postJobLink = document.querySelector('a[href="post-job.html"]');
    if (postJobLink) {
        if (user && user.type === 'employer') {
            postJobLink.parentElement.style.display = 'block';
        } else {
            postJobLink.parentElement.style.display = 'none';
        }
    }
}

// Call updateNavigation on page load
document.addEventListener('DOMContentLoaded', function() {
    updateNavigation();

    // Mobile menu
    const hamburger = document.querySelector('.hamburger');
    const navMenu = document.querySelector('.nav-menu');

    if (hamburger) {
        hamburger.addEventListener('click', function() {
            navMenu.classList.toggle('active');
        });
    }

    // Login forms
    const jobseekerLoginForm = document.getElementById('jobseekerLoginForm');
    const employerLoginForm = document.getElementById('employerLoginForm');

    if (jobseekerLoginForm) {
        jobseekerLoginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            handleLogin('jobseeker');
        });
    }

    if (employerLoginForm) {
        employerLoginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            handleLogin('employer');
        });
    }

    // Registration forms
    const jobseekerRegForm = document.getElementById('jobseekerRegForm');
    const employerRegForm = document.getElementById('employerRegForm');

    if (jobseekerRegForm) {
        jobseekerRegForm.addEventListener('submit', function(e) {
            e.preventDefault();
            handleRegistration('jobseeker');
        });
    }

    if (employerRegForm) {
        employerRegForm.addEventListener('submit', function(e) {
            e.preventDefault();
            handleRegistration('employer');
        });
    }

    // Check URL params for registration type
    const urlParams = new URLSearchParams(window.location.search);
    const regType = urlParams.get('type');
    if (regType && window.location.pathname.includes('register.html')) {
        switchRegTab(regType);
    }
});

// Switch card tabs (Login/Register for each card)
function switchCardTab(userType, action) {
    const loginContent = document.getElementById(userType + 'Login');
    const registerContent = document.getElementById(userType + 'Register');
    const card = loginContent ? loginContent.closest('.auth-card') : registerContent.closest('.auth-card');
    const tabs = card.querySelectorAll('.card-tab-btn');

    tabs.forEach(tab => tab.classList.remove('active'));
    event.target.classList.add('active');

    if (action === 'login') {
        if (loginContent) loginContent.classList.add('active');
        if (registerContent) registerContent.classList.remove('active');
    } else {
        if (loginContent) loginContent.classList.remove('active');
        if (registerContent) registerContent.classList.add('active');
    }
}

// Toggle login type (Job Seeker/Employer)
function toggleLoginType() {
    const toggle = document.getElementById('loginToggle');
    const jobseekerTab = document.getElementById('jobseekerTab');
    const employerTab = document.getElementById('employerTab');

    if (toggle.checked) {
        jobseekerTab.classList.remove('active');
        employerTab.classList.add('active');
    } else {
        jobseekerTab.classList.add('active');
        employerTab.classList.remove('active');
    }
}

// Handle login
function handleLogin(type) {
    const email = document.getElementById(type === 'jobseeker' ? 'jsEmail' : 'empEmail').value;
    const password = document.getElementById(type === 'jobseeker' ? 'jsPassword' : 'empPassword').value;

    const users = JSON.parse(localStorage.getItem('users'));
    const userList = type === 'jobseeker' ? users.jobseekers : users.employers;

    const user = userList.find(u => u.email === email && u.password === password);

    if (user) {
        const currentUser = { ...user, type };
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        
        if (type === 'employer') {
            window.location.href = 'post-job.html';
        } else {
            window.location.href = 'jobs.html';
        }
    } else {
        alert('Invalid email or password.');
    }
}

// Toggle register type (Job Seeker/Employer)
function toggleRegisterType() {
    const toggle = document.getElementById('registerToggle');
    const jobseekerTab = document.getElementById('jobseekerRegTab');
    const employerTab = document.getElementById('employerRegTab');

    if (toggle.checked) {
        jobseekerTab.classList.remove('active');
        employerTab.classList.add('active');
    } else {
        jobseekerTab.classList.add('active');
        employerTab.classList.remove('active');
    }
}

// Handle registration
function handleRegistration(type) {
    if (type === 'jobseeker') {
        const name = document.getElementById('jsName').value;
        const email = document.getElementById('jsRegEmail').value;
        const location = document.getElementById('jsLocation').value;
        const phone = document.getElementById('jsPhone').value;
        const password = document.getElementById('jsRegPassword').value;
        const confirmPassword = document.getElementById('jsConfirmPassword').value;

        // Validate Gmail
        if (!email.toLowerCase().endsWith('@gmail.com')) {
            alert('Only Gmail addresses are accepted for registration!');
            return;
        }

        if (password !== confirmPassword) {
            alert('Passwords do not match!');
            return;
        }

        if (password.length < 6) {
            alert('Password must be at least 6 characters long!');
            return;
        }

        const users = JSON.parse(localStorage.getItem('users'));
        
        // Check if email exists
        if (users.jobseekers.find(u => u.email === email)) {
            alert('Email already registered!');
            return;
        }

        users.jobseekers.push({ email, password, name, location, phone });
        localStorage.setItem('users', JSON.stringify(users));

        alert('Registration successful! Please login.');
        location.reload();
    } else {
        const company = document.getElementById('empCompany').value;
        const contactName = document.getElementById('empContactName').value;
        const email = document.getElementById('empRegEmail').value;
        const location = document.getElementById('empLocation').value;
        const phone = document.getElementById('empPhone').value;
        const password = document.getElementById('empRegPassword').value;
        const confirmPassword = document.getElementById('empConfirmPassword').value;

        // Validate Gmail
        if (!email.toLowerCase().endsWith('@gmail.com')) {
            alert('Only Gmail addresses are accepted for registration!');
            return;
        }

        if (password !== confirmPassword) {
            alert('Passwords do not match!');
            return;
        }

        if (password.length < 6) {
            alert('Password must be at least 6 characters long!');
            return;
        }

        const users = JSON.parse(localStorage.getItem('users'));
        
        // Check if email exists
        if (users.employers.find(u => u.email === email)) {
            alert('Email already registered!');
            return;
        }

        users.employers.push({ email, password, company, contactName, location, phone });
        localStorage.setItem('users', JSON.stringify(users));

        alert('Registration successful! Please login.');
        window.location.reload();
    }
}
