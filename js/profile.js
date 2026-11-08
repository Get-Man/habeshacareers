// Check if user is logged in
document.addEventListener('DOMContentLoaded', function() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
    
    if (!currentUser || currentUser.type !== 'jobseeker') {
        alert('Please login as a job seeker to access this page');
        window.location.href = 'login.html';
        return;
    }
    
    // Populate phone country code and country dropdowns
    if (typeof countriesData !== 'undefined') {
        populatePhoneCountryCode();
        populateCountryDropdown();
    }
    
    loadUserProfile();
    loadSavedJobs();
    loadApplications();
    loadCVList();
});

// Populate phone country code dropdown
function populatePhoneCountryCode() {
    const phoneCountryCode = document.getElementById('phoneCountryCode');
    
    if (!phoneCountryCode || typeof countriesData === 'undefined') return;
    
    countriesData.forEach(country => {
        const option = document.createElement('option');
        option.value = country.code;
        option.textContent = `${country.flag} ${country.dialCode}`;
        option.setAttribute('data-dial-code', country.dialCode);
        option.setAttribute('data-country', country.name);
        phoneCountryCode.appendChild(option);
    });
    
    // Set Ethiopia as default
    phoneCountryCode.value = 'ET';
}

// Populate country dropdown
function populateCountryDropdown() {
    const countrySelect = document.getElementById('country');
    
    if (!countrySelect || typeof countriesData === 'undefined') return;
    
    countriesData.forEach(country => {
        const option = document.createElement('option');
        option.value = country.name;
        option.textContent = `${country.flag} ${country.name}`;
        option.setAttribute('data-code', country.code);
        countrySelect.appendChild(option);
    });
    
    // Set Ethiopia as default
    countrySelect.value = 'Ethiopia';
}

// Load user profile
function loadUserProfile() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    
    document.getElementById('userName').textContent = currentUser.name || 'Job Seeker';
    document.getElementById('userEmail').textContent = currentUser.name || 'Job Seeker';
    document.getElementById('userInitials').textContent = getInitials(currentUser.name || 'JS');
    
    // Load profile form if fields exist
    if (document.getElementById('fullName')) {
        // Use fullName if available, otherwise use name (but not if it's an email)
        const nameValue = currentUser.fullName || currentUser.name || '';
        document.getElementById('fullName').value = nameValue.includes('@') ? '' : nameValue;
    }
    if (document.getElementById('email')) {
        document.getElementById('email').value = currentUser.email || '';
    }
    if (document.getElementById('phone')) {
        // Extract just the number part if phone includes country code
        const phoneValue = currentUser.phone || '';
        const phoneNumber = phoneValue.replace(/^\+\d+\s*/, ''); // Remove country code
        document.getElementById('phone').value = phoneNumber;
    }
    if (document.getElementById('birthday')) {
        document.getElementById('birthday').value = currentUser.birthday || '';
    }
    if (document.getElementById('sex')) {
        document.getElementById('sex').value = currentUser.sex || '';
    }
    if (document.getElementById('profession')) {
        document.getElementById('profession').value = currentUser.title || '';
    }
    if (document.getElementById('yearsOfExperience')) {
        document.getElementById('yearsOfExperience').value = currentUser.yearsOfExperience || '';
    }
    if (document.getElementById('city')) {
        document.getElementById('city').value = currentUser.city || '';
    }
    if (document.getElementById('address')) {
        document.getElementById('address').value = currentUser.address || '';
    }
    
    // Load dynamic sections
    loadEducationList();
    loadExperienceList();
    loadSkillsList();
    loadLanguagesList();
    loadProjectsList();
    loadCertificationsList();
    loadReferencesList();
    
    // Check and toggle section visibility
    toggleSectionVisibility();
}

// Check if personal information is complete and show/hide sections
function toggleSectionVisibility() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    
    // Check if personal information is filled
    const fullName = currentUser.fullName || currentUser.name || '';
    const hasValidName = fullName && !fullName.includes('@');
    const hasEmail = currentUser.email && currentUser.email.includes('@');
    const hasPhone = currentUser.phone;
    const hasCity = currentUser.city;
    const hasCountry = currentUser.country;
    
    // Personal info is considered filled if at least name, email, phone, city, and country are provided
    const isPersonalInfoFilled = hasValidName && hasEmail && hasPhone && hasCity && hasCountry;
    
    // Show/hide the locked notice
    const lockedNotice = document.getElementById('sectionsLockedNotice');
    if (lockedNotice) {
        if (isPersonalInfoFilled) {
            lockedNotice.style.display = 'none';
        } else {
            lockedNotice.style.display = 'flex';
        }
    }
    
    // Get all form sections except Personal Information
    const formSections = document.querySelectorAll('.form-section');
    
    formSections.forEach(section => {
        const sectionTitle = section.querySelector('.section-title');
        if (sectionTitle && !sectionTitle.textContent.includes('Personal Information')) {
            if (isPersonalInfoFilled) {
                section.style.display = 'block';
            } else {
                section.style.display = 'none';
            }
        }
    });
    
    // Also hide/show the final form actions (Save as Draft and Save Profile buttons)
    const formActions = document.querySelector('.form-actions');
    if (formActions) {
        if (isPersonalInfoFilled) {
            formActions.style.display = 'flex';
        } else {
            formActions.style.display = 'none';
        }
    }
}

function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

// Switch tabs
function switchTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Remove active from all buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected tab
    document.getElementById(tabName).classList.add('active');
    
    // Add active to clicked button
    event.target.closest('.tab-btn').classList.add('active');
}

// Save Personal Information Only
function savePersonalInformation() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    
    // Validate required fields
    const fullNameValue = document.getElementById('fullName').value.trim();
    const emailValue = document.getElementById('email').value.trim();
    const phoneNumber = document.getElementById('phone').value.trim();
    const cityValue = document.getElementById('city').value.trim();
    const countryValue = document.getElementById('country').value;
    
    if (!fullNameValue || !emailValue || !phoneNumber || !cityValue || !countryValue) {
        alert('Please fill in all required fields (Name, Email, Phone, City, Country)');
        return;
    }
    
    // Save personal information fields
    currentUser.name = fullNameValue;
    currentUser.fullName = fullNameValue;
    currentUser.email = emailValue;
    
    // Phone with country code
    const phoneCountryCode = document.getElementById('phoneCountryCode');
    if (phoneCountryCode && phoneNumber) {
        const selectedOption = phoneCountryCode.options[phoneCountryCode.selectedIndex];
        const dialCode = selectedOption.textContent.split(' ')[1];
        currentUser.phone = `${dialCode} ${phoneNumber}`;
    }
    
    currentUser.birthday = document.getElementById('birthday').value;
    currentUser.sex = document.getElementById('sex').value;
    currentUser.title = document.getElementById('profession').value;
    currentUser.yearsOfExperience = document.getElementById('yearsOfExperience').value;
    currentUser.country = countryValue;
    currentUser.city = cityValue;
    currentUser.region = document.getElementById('region').value;
    currentUser.address = document.getElementById('address').value;
    currentUser.bio = document.getElementById('bio').value;
    
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    
    // Show saved indicator
    const savedIndicator = document.getElementById('personalInfoSaved');
    if (savedIndicator) {
        savedIndicator.style.display = 'inline-flex';
        setTimeout(() => {
            savedIndicator.style.display = 'none';
        }, 3000);
    }
    
    // Reload profile header to show updated information
    loadProfileHeader();
    
    // Show the rest of the form sections
    toggleSectionVisibility();
    
    alert('Personal information saved successfully! You can now fill in the rest of your profile.');
}

// Save as Draft (saves everything without validation)
function saveAsDraft() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    
    // Save all fields without validation
    const fullNameValue = document.getElementById('fullName').value;
    if (fullNameValue) {
        currentUser.name = fullNameValue;
        currentUser.fullName = fullNameValue;
    }
    
    if (document.getElementById('email').value) {
        currentUser.email = document.getElementById('email').value;
    }
    
    // Phone with country code
    const phoneCountryCode = document.getElementById('phoneCountryCode');
    const phoneNumber = document.getElementById('phone').value;
    if (phoneCountryCode && phoneNumber) {
        const selectedOption = phoneCountryCode.options[phoneCountryCode.selectedIndex];
        const dialCode = selectedOption.textContent.split(' ')[1];
        currentUser.phone = `${dialCode} ${phoneNumber}`;
    }
    
    currentUser.birthday = document.getElementById('birthday').value;
    currentUser.sex = document.getElementById('sex').value;
    currentUser.title = document.getElementById('profession').value;
    currentUser.yearsOfExperience = document.getElementById('yearsOfExperience').value;
    currentUser.country = document.getElementById('country').value;
    currentUser.city = document.getElementById('city').value;
    currentUser.region = document.getElementById('region').value;
    currentUser.address = document.getElementById('address').value;
    currentUser.bio = document.getElementById('bio').value;
    
    // Save all other sections (education, experience, skills, etc.)
    saveAllProfileSections(currentUser);
    
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    
    // Reload profile header
    loadProfileHeader();
    
    alert('Profile saved as draft! You can continue editing later.');
}

// Helper function to save all profile sections
function saveAllProfileSections(currentUser) {
    // Education, experience, skills, languages, etc. are already saved to localStorage
    // in their respective arrays, so we just need to reference them
    currentUser.hasEducation = (JSON.parse(localStorage.getItem('education') || '[]')).length > 0;
    currentUser.hasExperience = (JSON.parse(localStorage.getItem('experience') || '[]')).length > 0;
    currentUser.hasSkills = (JSON.parse(localStorage.getItem('skills') || '[]')).length > 0;
    currentUser.hasLanguages = (JSON.parse(localStorage.getItem('languages') || '[]')).length > 0;
    currentUser.hasProjects = (JSON.parse(localStorage.getItem('projects') || '[]')).length > 0;
    currentUser.hasCertifications = (JSON.parse(localStorage.getItem('certifications') || '[]')).length > 0;
    currentUser.hasReferences = (JSON.parse(localStorage.getItem('references') || '[]')).length > 0;
    
    // Save activities if exists
    const activitiesField = document.getElementById('activities');
    if (activitiesField) {
        currentUser.activities = activitiesField.value;
    }
}

// Final Save Profile (with validation)
document.getElementById('profileForm').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    
    // Validate required personal information fields
    const fullNameValue = document.getElementById('fullName').value.trim();
    const emailValue = document.getElementById('email').value.trim();
    const phoneNumber = document.getElementById('phone').value.trim();
    const cityValue = document.getElementById('city').value.trim();
    const countryValue = document.getElementById('country').value;
    
    if (!fullNameValue || !emailValue || !phoneNumber || !cityValue || !countryValue) {
        alert('Please complete the Personal Information section first (Name, Email, Phone, City, Country are required)');
        return;
    }
    
    // Save all personal information fields
    currentUser.name = fullNameValue;
    currentUser.fullName = fullNameValue;
    currentUser.email = emailValue;
    
    // Phone with country code
    const phoneCountryCode = document.getElementById('phoneCountryCode');
    if (phoneCountryCode && phoneNumber) {
        const selectedOption = phoneCountryCode.options[phoneCountryCode.selectedIndex];
        const dialCode = selectedOption.textContent.split(' ')[1];
        currentUser.phone = `${dialCode} ${phoneNumber}`;
    }
    
    currentUser.birthday = document.getElementById('birthday').value;
    currentUser.sex = document.getElementById('sex').value;
    currentUser.title = document.getElementById('profession').value;
    currentUser.yearsOfExperience = document.getElementById('yearsOfExperience').value;
    currentUser.country = countryValue;
    currentUser.city = cityValue;
    currentUser.region = document.getElementById('region').value;
    currentUser.address = document.getElementById('address').value;
    currentUser.bio = document.getElementById('bio').value;
    
    // Save all other sections
    saveAllProfileSections(currentUser);
    
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    
    // Reload profile header to show updated information
    loadProfileHeader();
    
    alert('Profile saved successfully!');
});

// Load saved jobs
function loadSavedJobs() {
    const savedJobIds = JSON.parse(localStorage.getItem('savedJobs') || '[]');
    const allJobs = getAllJobs();
    const savedJobs = allJobs.filter(job => savedJobIds.includes(job.id));
    
    const container = document.getElementById('savedJobsList');
    
    if (savedJobs.length === 0) {
        container.innerHTML = `
            <div class="empty-state-card">
                <svg viewBox="0 0 24 24" width="64" height="64" fill="currentColor">
                    <path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/>
                </svg>
                <h4>No Saved Jobs</h4>
                <p>You haven't saved any jobs yet. Browse available positions and bookmark your favorites!</p>
                <a href="jobs.html" class="btn-primary">Browse Jobs</a>
            </div>
        `;
        return;
    }
    
    container.innerHTML = savedJobs.map(job => `
        <div class="saved-job-item">
            <div class="job-info">
                <h4>${job.title}</h4>
                <p>${job.company}</p>
                <div class="job-meta">
                    <span>📍 ${job.location}</span>
                    <span>💼 ${job.type}</span>
                </div>
            </div>
            <div class="job-actions">
                <a href="job-details.html?id=${job.id}" class="btn-primary">View</a>
                <button onclick="unsaveJob(${job.id})" class="btn-secondary">Remove</button>
            </div>
        </div>
    `).join('');
}

function unsaveJob(jobId) {
    const savedJobs = JSON.parse(localStorage.getItem('savedJobs') || '[]');
    const index = savedJobs.indexOf(jobId);
    
    if (index > -1) {
        savedJobs.splice(index, 1);
        localStorage.setItem('savedJobs', JSON.stringify(savedJobs));
        loadSavedJobs();
    }
}

// Load applications
function loadApplications() {
    const applications = JSON.parse(localStorage.getItem('myApplications') || '[]');
    const container = document.getElementById('applicationsList');
    
    if (applications.length === 0) {
        container.innerHTML = `
            <div class="empty-state-card">
                <svg viewBox="0 0 24 24" width="64" height="64" fill="currentColor">
                    <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
                </svg>
                <h4>No Applications Yet</h4>
                <p>You haven't applied to any jobs yet. Start applying to track your applications here!</p>
                <a href="jobs.html" class="btn-primary">Find Jobs</a>
            </div>
        `;
        return;
    }
    
    container.innerHTML = applications.map(app => `
        <div class="application-item">
            <div class="application-info">
                <h4>${app.jobTitle}</h4>
                <p>${app.company}</p>
                <p class="application-date">Applied on: ${app.appliedDate}</p>
            </div>
            <div class="application-status ${app.status}">
                ${app.status}
            </div>
        </div>
    `).join('');
}

// CV Upload
document.getElementById('cvFileInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    
    if (file) {
        if (file.size > 5 * 1024 * 1024) {
            alert('File size should be less than 5MB');
            return;
        }
        
        const cvList = JSON.parse(localStorage.getItem('cvList') || '[]');
        
        cvList.push({
            name: file.name,
            size: (file.size / 1024).toFixed(2) + ' KB',
            uploadDate: new Date().toLocaleDateString()
        });
        
        localStorage.setItem('cvList', JSON.stringify(cvList));
        loadCVList();
        alert('CV uploaded successfully!');
    }
});

function loadCVList() {
    const cvList = JSON.parse(localStorage.getItem('cvList') || '[]');
    const container = document.getElementById('cvList');
    
    if (cvList.length === 0) {
        return;
    }
    
    container.innerHTML = '<h4>Uploaded CVs</h4>' + cvList.map((cv, index) => `
        <div class="cv-item">
            <div class="cv-info">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                    <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6z"/>
                </svg>
                <div>
                    <strong>${cv.name}</strong>
                    <p>${cv.size} • Uploaded ${cv.uploadDate}</p>
                </div>
            </div>
            <button onclick="deleteCV(${index})" class="btn-delete">Delete</button>
        </div>
    `).join('');
}

function deleteCV(index) {
    const cvList = JSON.parse(localStorage.getItem('cvList') || '[]');
    cvList.splice(index, 1);
    localStorage.setItem('cvList', JSON.stringify(cvList));
    loadCVList();
}

// Job Alerts
document.getElementById('alertsForm').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const categories = Array.from(document.getElementById('alertCategories').selectedOptions).map(opt => opt.value);
    const locations = document.getElementById('alertLocations').value;
    const emailAlerts = document.getElementById('emailAlerts').checked;
    
    const alertPreferences = {
        categories,
        locations,
        emailAlerts
    };
    
    localStorage.setItem('jobAlertPreferences', JSON.stringify(alertPreferences));
    alert('Job alert preferences saved!');
});

// Logout
function logout() {
    localStorage.removeItem('currentUser');
    window.location.href = 'index.html';
}


// Education Management
let educationData = JSON.parse(localStorage.getItem('education') || '[]');

function loadEducationList() {
    const container = document.getElementById('educationList');
    if (!container) return;
    
    if (educationData.length === 0) {
        container.innerHTML = '<p class="empty-state">No education added yet.</p>';
        return;
    }
    
    container.innerHTML = educationData.map((edu, index) => `
        <div class="list-item">
            <div class="list-item-header">
                <span class="list-item-title">${edu.institution}</span>
                <button type="button" class="btn-remove" onclick="removeEducation(${index})">Remove</button>
            </div>
            <div class="form-grid">
                <div><strong>Degree:</strong> ${edu.degree}</div>
                <div><strong>Major:</strong> ${edu.major}</div>
                <div><strong>GPA:</strong> ${edu.gpa || 'N/A'}</div>
                <div><strong>Graduation:</strong> ${edu.graduationYear}</div>
            </div>
        </div>
    `).join('');
}

// Ethiopian Universities List
const ethiopianUniversities = [
    "20-20 Open College",
    "A.R.T. Medical College Ethiopia",
    "Abyssinia College",
    "Adama General Hospital and Medical College",
    "Adama Science and Technology University",
    "Addis Ababa Medical College",
    "Addis Ababa Medical and Business College",
    "Addis Ababa Science and Technology University",
    "Addis Ababa University",
    "Addis College",
    "Addis Continental Institute of Public Health",
    "Adigrat University",
    "Admas University",
    "Africa Beza College",
    "Africa Health Science College",
    "Africa Medical College",
    "Aksum University",
    "Alkan Health Science Business and Technology College",
    "Alliance College",
    "Alpha University College",
    "Ambo University",
    "Arba Minch University",
    "Arsi University",
    "Assosa University",
    "Atlas College",
    "Ayer Tena Health Science College",
    "Bahir Dar University",
    "Bamba College",
    "Belay Zeleke Health College",
    "Ben Meskerem College",
    "Bethel Medical College",
    "Bezawit College",
    "Birhan College",
    "Bisrat College",
    "Biya College",
    "Blue Mark College",
    "Blue Nile College",
    "Bonga University",
    "Borana University",
    "BST College",
    "Bule Hora University",
    "Central Health College",
    "Chilalo Health Science and Technology College",
    "Chokie Fana College",
    "CPU Business and Information Technology College",
    "Damat Hotel and Tourism College",
    "Dandii Boru College",
    "Dangila Andinet Health Science College",
    "Debark University",
    "Debre Berhan University",
    "Debre Markos University",
    "Debre Tabor University",
    "Debub Ethiopia College",
    "Dembi Dolo University",
    "Deutsche Hochschule Fur Medizin",
    "Dilla University",
    "Dire Dawa University",
    "Dream Land College",
    "Durman College",
    "Dynamic International University College",
    "ECUSTA Higher Learning Institute",
    "Ethio Lence College",
    "Ethio-Smart College",
    "Ethio-Victory College",
    "Ethiopian Adventist College",
    "Ethiopian Adventist College",
    "Ethiopian Aviation University",
    "Ethiopian Catholic University",
    "Ethiopian Civil Service University",
    "Ethiopian Defense University",
    "Ethiopian Police University",
    "Ethiopis Distance Education College",
    "Fekede Egzi College",
    "Finote Selam College",
    "Fura College",
    "Gabist College",
    "Gage University",
    "Gambella University",
    "Gamby Medical and Business College",
    "Genius-Land College",
    "Global College",
    "Gofa Universal College",
    "Golden State College",
    "Gotoniyal College",
    "Grace College of Business and Computer Science",
    "Grand Mark International College",
    "Great College",
    "Hamlin College of Midwives",
    "Harambee University",
    "Haramaya University",
    "Harar Agro Technical and Technology College",
    "Harar Health Science College",
    "Hawassa Health Science College",
    "Hawassa University",
    "Hayat Medical College",
    "Hayome Medical College",
    "Highland College",
    "HiLCoE School of Computer Science and Technology",
    "Hope Enterprise University College",
    "Horizon College",
    "Infonet College",
    "Injibara University",
    "International Leadership Institute",
    "Jigdan College",
    "Jigjiga University",
    "Jimma University",
    "Jinka University",
    "Joint Vision College",
    "Kanenus College",
    "Karvard College",
    "Kea-Med Medical College",
    "Kebri Dehar University",
    "Kotebe University of Education",
    "Leadstar College of Management and Leadership",
    "Lorcan Medical College",
    "Lucy College",
    "Lunar International College",
    "Madda Walabu University",
    "Medco Bio-Medical College",
    "Mekane Yesus Management and Leadership College",
    "Mekdela Amba University",
    "Mekelle University",
    "Menelik II Health Science College",
    "Metu University",
    "Micro Business College",
    "MicroLink Information Technology College",
    "Mishquen College",
    "Mizan-Tepi University",
    "Myungsang Medical College",
    "National College",
    "Network College",
    "New Generation University College",
    "New Global Vision College",
    "New Millennium College",
    "New Vision College",
    "Nile College",
    "Oda Bultum University",
    "Omega Health College",
    "Oromia State University",
    "Oromiya Public Service College",
    "Paradise Valley College",
    "Paramed College",
    "PESC Information Systems College",
    "Pharma Health Science College",
    "Poly Institute of Technology",
    "Queen's College",
    "Rada College",
    "Raya University",
    "Rehoboth Harme College",
    "Rhobot Medical College",
    "Rift Valley University",
    "Royal College",
    "Samara University",
    "Santé Medical College",
    "Sata Business and Technology College",
    "Seamless College of Distance Education",
    "Selale University",
    "Selam Nursing College",
    "Select College",
    "Selihom School of Nursing",
    "Semera University",
    "Seven Star Health Science College",
    "Sheba University College",
    "Sodo Christian Hospital (PAACS)",
    "Soloda Health and Technology College",
    "SRI SAI College",
    "St. Lideta Health Science College",
    "St. Mary's University",
    "St. Paul's Hospital Millennium Medical College",
    "Summit College",
    "Tech Zone Engineering and Business College",
    "Tis Abay College",
    "Top College",
    "Tropical College of Medicine",
    "UNSA (United Nations School Addis Ababa)",
    "Unity University",
    "Universal Medical and Business College",
    "University of Gondar",
    "US College",
    "Victory College",
    "Wachamo University",
    "Werabe University",
    "Western Star College",
    "Western University College",
    "Wolaita Sodo University",
    "Woldia University",
    "Wolkite University",
    "Wollega University",
    "Wollo University",
    "Yanet Medical College",
    "Yardstick International College",
    "Yekatit 12 Hospital Medical College",
    "Yom College",
    "Zemen Development and Management College",
    "Zion College"
];

// Field of Study / Major List
const fieldsOfStudy = [
    "Accounting and Finance",
    "Adult Education and Community Development",
    "Aeronautical Engineering",
    "Afan Oromo Language and Literature",
    "Afan Oromo Literature and Folklore",
    "Afar Language and Literature",
    "Agribusiness and Value Chain Management",
    "Agricultural Economics",
    "Aircraft Maintenance Engineering",
    "Amharic Language and Literature",
    "Amharic Literature and Folklore",
    "Animal Science",
    "Anthropology",
    "Anthropology of Ethiopian Societies",
    "Applied Biology",
    "Applied Chemistry",
    "Arabic Language",
    "Architecture",
    "Automotive Engineering",
    "Awngi Language and Literature",
    "Banking and Finance",
    "Bench Language and Literature",
    "Biology",
    "Biomedical Engineering",
    "Biotechnology",
    "Chemical Engineering",
    "Chemistry",
    "Chinese Language",
    "Civics and Ethical Studies",
    "Civil Engineering",
    "Computer Science",
    "Construction Technology and Management (CoTM)",
    "Cooperative Management",
    "Dawro Language and Literature",
    "Dentistry",
    "Early Childhood Care and Education",
    "Economics",
    "Ecotourism and Wildlife Management",
    "Educational Planning and Management (EdPM)",
    "Electrical and Computer Engineering",
    "Emergency and Critical Care Nursing",
    "English Language and Literature",
    "Environmental Health Science",
    "Environmental Science",
    "Ethiopian Studies",
    "Fashion Design",
    "Film and Media Studies",
    "Fisheries and Aquatic Sciences",
    "Folklore and Cultural Studies",
    "Food Process Engineering",
    "Forestry",
    "French Language",
    "Gamo Language and Literature",
    "Garment Engineering",
    "Gedeo Language and Literature",
    "Geez Language and Literature",
    "Gender and Development Studies",
    "General Medicine",
    "Geography and Environmental Studies",
    "Geology",
    "Geomatics Engineering",
    "Goffa Language and Literature",
    "Gurage Language and Literature",
    "Hadiyya Language and Literature",
    "Harari Language and Literature",
    "History and Heritage Management",
    "Horticulture",
    "Hotel and Tourism Management",
    "Human Nutrition",
    "Hydraulics and Water Resources Engineering",
    "Indigenous Knowledge Systems",
    "Industrial Engineering",
    "Information Systems",
    "Information Technology (IT)",
    "Irrigation Engineering",
    "Journalism and Communication",
    "Kafa Language and Literature",
    "Kambaata Language and Literature",
    "Konso Language and Literature",
    "Koorete Language and Literature",
    "Law",
    "Leather Engineering",
    "Logistics and Supply Chain Management",
    "Management",
    "Marketing Management",
    "Material Science Engineering",
    "Mathematics",
    "Mechanical Engineering",
    "Medical Laboratory Science",
    "Medicine",
    "Midwifery",
    "Mining Engineering",
    "Natural Resource Management",
    "Nursing",
    "Optometry",
    "Oromo Folklore and Cultural Studies",
    "Pharmacy",
    "Philology",
    "Philosophy",
    "Physics",
    "Physiotherapy",
    "Plant Science",
    "Political Science and International Relations",
    "Psychiatric Nursing",
    "Psychology",
    "Public Administration and Development Management",
    "Public Health",
    "Public Health (Health Officer)",
    "Radiology Technology",
    "Rural Development and Agricultural Extension",
    "Sidama Language and Literature",
    "Sign Language and Deaf Culture",
    "Silt'e Language and Literature",
    "Social Work",
    "Sociology",
    "Software Engineering",
    "Somali Language and Literature",
    "Special Needs and Inclusive Education",
    "Sport Science",
    "Statistics",
    "Surgical Nursing",
    "Surveying Engineering",
    "Textile Engineering",
    "Theatrical Arts",
    "Tigrigna Language and Literature",
    "Urban Planning and Design",
    "Veterinary Medicine",
    "Water Supply and Environmental Engineering",
    "Wolaytta Language and Literature"
];

function addEducation() {
    const container = document.getElementById('educationList');
    
    // Create inline form with searchable dropdown
    const formHTML = `
        <div class="inline-form" id="educationForm">
            <h4>Add Education</h4>
            <div class="form-grid">
                <div class="form-group" style="grid-column: 1 / -1;">
                    <label>Institution Name *</label>
                    <div class="searchable-select">
                        <input type="text" id="eduInstitutionSearch" placeholder="Search or select institution..." autocomplete="off" oninput="filterInstitutions()" onfocus="showInstitutionDropdown()" required>
                        <div id="institutionDropdown" class="dropdown-list" style="display: none;">
                            ${ethiopianUniversities.map(uni => `<div class="dropdown-item" onclick="selectInstitution('${uni}')">${uni}</div>`).join('')}
                            <div class="dropdown-item other-option" onclick="selectOtherInstitution()">
                                <strong>Other (Not Listed)</strong>
                            </div>
                        </div>
                    </div>
                    <input type="text" id="eduInstitutionOther" placeholder="Please specify institution name" style="display: none; margin-top: 0.5rem;">
                    <input type="hidden" id="eduInstitution" required>
                </div>
                <div class="form-group">
                    <label>Degree Type *</label>
                    <select id="eduDegree" required>
                        <option value="">Select Degree</option>
                        <option value="High School Diploma">High School Diploma</option>
                        <option value="Associate Degree">Associate Degree</option>
                        <option value="Bachelor's Degree">Bachelor's Degree</option>
                        <option value="Master's Degree">Master's Degree</option>
                        <option value="Doctorate (PhD)">Doctorate (PhD)</option>
                        <option value="Professional Degree">Professional Degree</option>
                        <option value="Certificate">Certificate</option>
                    </select>
                </div>
                <div class="form-group" style="grid-column: 1 / -1;">
                    <label>Field of Study / Major *</label>
                    <div class="searchable-select">
                        <input type="text" id="eduMajorSearch" placeholder="Search or select field of study..." autocomplete="off" oninput="filterMajors()" onfocus="showMajorDropdown()" required>
                        <div id="majorDropdown" class="dropdown-list" style="display: none;">
                            ${fieldsOfStudy.map(major => `<div class="dropdown-item" onclick="selectMajor('${major.replace(/'/g, "\\'")}')">${major}</div>`).join('')}
                            <div class="dropdown-item other-option" onclick="selectOtherMajor()">
                                <strong>Other (Not Listed)</strong>
                            </div>
                        </div>
                    </div>
                    <input type="text" id="eduMajorOther" placeholder="Please specify your field of study" style="display: none; margin-top: 0.5rem;">
                    <input type="hidden" id="eduMajor" required>
                </div>
                <div class="form-group">
                    <label>GPA (optional)</label>
                    <input type="text" id="eduGPA" placeholder="e.g., 3.8/4.0">
                </div>
                <div class="form-group">
                    <label>Graduation Year *</label>
                    <input type="text" id="eduYear" placeholder="e.g., 2023" required>
                </div>
            </div>
            <div class="form-actions">
                <button type="button" class="btn-primary" onclick="saveEducation()">Save</button>
                <button type="button" class="btn-secondary" onclick="cancelEducation()">Cancel</button>
            </div>
        </div>
    `;
    
    container.insertAdjacentHTML('afterbegin', formHTML);
    document.getElementById('eduInstitutionSearch').focus();
    
    // Close dropdown when clicking outside
    document.addEventListener('click', closeInstitutionDropdownOutside);
}

function showInstitutionDropdown() {
    document.getElementById('institutionDropdown').style.display = 'block';
}

function filterInstitutions() {
    const searchValue = document.getElementById('eduInstitutionSearch').value.toLowerCase();
    const dropdown = document.getElementById('institutionDropdown');
    const items = dropdown.querySelectorAll('.dropdown-item:not(.other-option)');
    
    let hasVisibleItems = false;
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        if (text.includes(searchValue)) {
            item.style.display = 'block';
            hasVisibleItems = true;
        } else {
            item.style.display = 'none';
        }
    });
    
    dropdown.style.display = 'block';
}

function selectInstitution(name) {
    document.getElementById('eduInstitutionSearch').value = name;
    document.getElementById('eduInstitution').value = name;
    document.getElementById('eduInstitutionOther').style.display = 'none';
    document.getElementById('institutionDropdown').style.display = 'none';
}

function selectOtherInstitution() {
    document.getElementById('eduInstitutionSearch').value = 'Other';
    document.getElementById('eduInstitutionOther').style.display = 'block';
    document.getElementById('eduInstitutionOther').focus();
    document.getElementById('institutionDropdown').style.display = 'none';
}

function closeInstitutionDropdownOutside(e) {
    const dropdown = document.getElementById('institutionDropdown');
    const searchInput = document.getElementById('eduInstitutionSearch');
    const majorDropdown = document.getElementById('majorDropdown');
    const majorSearchInput = document.getElementById('eduMajorSearch');
    
    if (dropdown && searchInput && !dropdown.contains(e.target) && e.target !== searchInput) {
        dropdown.style.display = 'none';
    }
    
    if (majorDropdown && majorSearchInput && !majorDropdown.contains(e.target) && e.target !== majorSearchInput) {
        majorDropdown.style.display = 'none';
    }
}

// Major dropdown functions
function showMajorDropdown() {
    document.getElementById('majorDropdown').style.display = 'block';
}

function filterMajors() {
    const searchValue = document.getElementById('eduMajorSearch').value.toLowerCase();
    const dropdown = document.getElementById('majorDropdown');
    const items = dropdown.querySelectorAll('.dropdown-item:not(.other-option)');
    
    let hasVisibleItems = false;
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        if (text.includes(searchValue)) {
            item.style.display = 'block';
            hasVisibleItems = true;
        } else {
            item.style.display = 'none';
        }
    });
    
    dropdown.style.display = 'block';
}

function selectMajor(name) {
    document.getElementById('eduMajorSearch').value = name;
    document.getElementById('eduMajor').value = name;
    document.getElementById('eduMajorOther').style.display = 'none';
    document.getElementById('majorDropdown').style.display = 'none';
}

function selectOtherMajor() {
    document.getElementById('eduMajorSearch').value = 'Other';
    document.getElementById('eduMajorOther').style.display = 'block';
    document.getElementById('eduMajorOther').focus();
    document.getElementById('majorDropdown').style.display = 'none';
}

function saveEducation() {
    let institution = document.getElementById('eduInstitution').value.trim();
    const otherInstitution = document.getElementById('eduInstitutionOther');
    
    // If "Other" was selected, use the custom input value
    if (otherInstitution.style.display !== 'none' && otherInstitution.value.trim()) {
        institution = otherInstitution.value.trim();
    }
    
    const degree = document.getElementById('eduDegree').value;
    
    let major = document.getElementById('eduMajor').value.trim();
    const otherMajor = document.getElementById('eduMajorOther');
    
    // If "Other" was selected for major, use the custom input value
    if (otherMajor.style.display !== 'none' && otherMajor.value.trim()) {
        major = otherMajor.value.trim();
    }
    
    const gpa = document.getElementById('eduGPA').value.trim();
    const graduationYear = document.getElementById('eduYear').value.trim();
    
    if (!institution || !degree || !major || !graduationYear) {
        alert('Please fill in all required fields');
        return;
    }
    
    educationData.push({ institution, degree, major, gpa, graduationYear });
    localStorage.setItem('education', JSON.stringify(educationData));
    
    document.removeEventListener('click', closeInstitutionDropdownOutside);
    document.getElementById('educationForm').remove();
    loadEducationList();
}

function cancelEducation() {
    document.removeEventListener('click', closeInstitutionDropdownOutside);
    document.getElementById('educationForm').remove();
    loadEducationList();
}

function removeEducation(index) {
    educationData.splice(index, 1);
    localStorage.setItem('education', JSON.stringify(educationData));
    loadEducationList();
}

// Work Experience Management
let experienceData = JSON.parse(localStorage.getItem('experience') || '[]');

function loadExperienceList() {
    const container = document.getElementById('experienceList');
    if (!container) return;
    
    if (experienceData.length === 0) {
        container.innerHTML = '<p class="empty-state">No work experience added yet.</p>';
        return;
    }
    
    container.innerHTML = experienceData.map((exp, index) => `
        <div class="list-item">
            <div class="list-item-header">
                <span class="list-item-title">${exp.jobTitle} at ${exp.company}</span>
                <button type="button" class="btn-remove" onclick="removeExperience(${index})">Remove</button>
            </div>
            <div class="form-grid">
                <div><strong>From:</strong> ${exp.from}</div>
                <div><strong>To:</strong> ${exp.to}</div>
            </div>
            <p style="margin-top: 0.5rem;">${exp.description}</p>
        </div>
    `).join('');
}

function addExperience() {
    const container = document.getElementById('experienceList');
    
    const formHTML = `
        <div class="inline-form" id="experienceForm">
            <h4>Add Work Experience</h4>
            <div class="form-grid">
                <div class="form-group">
                    <label>Company Name *</label>
                    <input type="text" id="expCompany" required>
                </div>
                <div class="form-group">
                    <label>Job Title *</label>
                    <input type="text" id="expTitle" required>
                </div>
                <div class="form-group">
                    <label>Start Date *</label>
                    <input type="month" id="expFrom" required>
                </div>
                <div class="form-group">
                    <label>End Date</label>
                    <input type="month" id="expTo" placeholder="Leave empty if current">
                </div>
                <div class="form-group" style="grid-column: 1 / -1;">
                    <label>
                        <input type="checkbox" id="expCurrent" onchange="toggleEndDate()"> Currently working here
                    </label>
                </div>
                <div class="form-group" style="grid-column: 1 / -1;">
                    <label>Job Description *</label>
                    <textarea id="expDescription" rows="4" placeholder="Describe your responsibilities and achievements..." required></textarea>
                </div>
            </div>
            <div class="form-actions">
                <button type="button" class="btn-primary" onclick="saveExperience()">Save</button>
                <button type="button" class="btn-secondary" onclick="cancelExperience()">Cancel</button>
            </div>
        </div>
    `;
    
    container.insertAdjacentHTML('afterbegin', formHTML);
    document.getElementById('expCompany').focus();
}

function toggleEndDate() {
    const checkbox = document.getElementById('expCurrent');
    const endDateInput = document.getElementById('expTo');
    
    if (checkbox.checked) {
        endDateInput.value = '';
        endDateInput.disabled = true;
    } else {
        endDateInput.disabled = false;
    }
}

function saveExperience() {
    const company = document.getElementById('expCompany').value.trim();
    const jobTitle = document.getElementById('expTitle').value.trim();
    const from = document.getElementById('expFrom').value;
    const to = document.getElementById('expCurrent').checked ? 'Present' : document.getElementById('expTo').value;
    const description = document.getElementById('expDescription').value.trim();
    
    if (!company || !jobTitle || !from || !description) {
        alert('Please fill in all required fields');
        return;
    }
    
    experienceData.push({ company, jobTitle, from, to, description });
    localStorage.setItem('experience', JSON.stringify(experienceData));
    
    document.getElementById('experienceForm').remove();
    loadExperienceList();
}

function cancelExperience() {
    document.getElementById('experienceForm').remove();
    loadExperienceList();
}

function removeExperience(index) {
    experienceData.splice(index, 1);
    localStorage.setItem('experience', JSON.stringify(experienceData));
    loadExperienceList();
}

// Skills Management
let skillsData = JSON.parse(localStorage.getItem('skills') || '[]');

// Initialize skills dropdown on page load
document.addEventListener('DOMContentLoaded', function() {
    if (typeof predefinedSkills !== 'undefined') {
        populateSkillsDropdown();
    }
});

function loadSkillsList() {
    const container = document.getElementById('skillsList');
    if (!container) return;
    
    if (skillsData.length === 0) {
        container.innerHTML = '<p class="empty-state">No skills added yet. Search and add skills below.</p>';
        return;
    }
    
    container.innerHTML = '<div class="skill-tags">' + skillsData.map((skill, index) => `
        <span class="skill-tag">
            ${skill}
            <button type="button" onclick="removeSkill(${index})">×</button>
        </span>
    `).join('') + '</div>';
}

function populateSkillsDropdown() {
    const dropdown = document.getElementById('skillsDropdown');
    if (!dropdown || typeof predefinedSkills === 'undefined') return;
    
    dropdown.innerHTML = predefinedSkills.map(skill => `
        <div class="skill-dropdown-item" onclick="addSkillFromList('${skill.replace(/'/g, "\\'")}')">
            <span class="plus-icon">+</span>
            <span>${skill}</span>
        </div>
    `).join('');
}

function showSkillsDropdown() {
    const dropdown = document.getElementById('skillsDropdown');
    if (dropdown) {
        dropdown.style.display = 'block';
    }
}

function filterSkills() {
    const searchValue = document.getElementById('skillSearch').value.toLowerCase();
    const dropdown = document.getElementById('skillsDropdown');
    const items = dropdown.querySelectorAll('.skill-dropdown-item');
    
    let hasVisibleItems = false;
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        if (text.includes(searchValue)) {
            item.style.display = 'flex';
            hasVisibleItems = true;
        } else {
            item.style.display = 'none';
        }
    });
    
    dropdown.style.display = hasVisibleItems || searchValue ? 'block' : 'none';
}

function addSkillFromList(skill) {
    if (!skillsData.includes(skill)) {
        skillsData.push(skill);
        localStorage.setItem('skills', JSON.stringify(skillsData));
        loadSkillsList();
        
        // Clear search and hide dropdown
        const searchInput = document.getElementById('skillSearch');
        if (searchInput) searchInput.value = '';
        const dropdown = document.getElementById('skillsDropdown');
        if (dropdown) dropdown.style.display = 'none';
    } else {
        alert('This skill is already added!');
    }
}

function removeSkill(index) {
    skillsData.splice(index, 1);
    localStorage.setItem('skills', JSON.stringify(skillsData));
    loadSkillsList();
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('skillsDropdown');
    const searchInput = document.getElementById('skillSearch');
    
    if (dropdown && searchInput && !dropdown.contains(e.target) && e.target !== searchInput) {
        dropdown.style.display = 'none';
    }
});

// Languages Management
let languagesData = JSON.parse(localStorage.getItem('languages') || '[]');

function loadLanguagesList() {
    const container = document.getElementById('languagesList');
    if (!container) return;
    
    if (languagesData.length === 0) {
        container.innerHTML = '<p class="empty-state">No languages added yet.</p>';
        return;
    }
    
    container.innerHTML = '<div class="language-tags">' + languagesData.map((lang, index) => `
        <span class="language-tag">
            <strong>${lang.name}</strong>
            <span>${lang.proficiency}</span>
            <button type="button" onclick="removeLanguage(${index})" title="Remove ${lang.name}">×</button>
        </span>
    `).join('') + '</div>';
}

// Comprehensive Languages List
const worldLanguages = [
    "Aari", "Afar", "Afrikaans", "Akan", "Alaba", "Amharic", "Anfillo", "Anuak", "Arabic", "Arbore",
    "Argobba", "Awngi", "Afaan Oromo", "Baiso", "Basketo", "Bench", "Bengali", "Berta", "Bodi", "Borana",
    "Borna", "Bulgarian", "Burji", "Burmese", "Chaha", "Chinese (Mandarin)", "Czech", "Daasanach", "Dawro", "Dime",
    "Dirasha", "Dizi", "Dorze", "Dutch", "English", "Farsi (Persian)", "French", "Gafat", "Gamo", "Gedeo",
    "Ge'ez", "German", "Gofa", "Greek", "Gujarati", "Gumuz", "Gurage", "Hadiya", "Hamer", "Harari",
    "Hausa", "Hindi", "Hozo", "Hungarian", "Igbo", "Indonesian", "Inor", "Italian", "Japanese", "Javanese",
    "Kachama-Ganjule", "Kafa", "Kambaata", "Kannada", "Karo", "Khmer", "Kinyarwanda", "Kiswahili (Swahili)", "Komo", "Konso",
    "Koorete", "Korean", "Kurdish", "Kwegu", "Libido", "Majang", "Malay", "Malayalam", "Male", "Marathi",
    "Me'en", "Melo", "Mesqan", "Mursi", "Nayi", "Nepali", "Nuer", "Nyangatom", "Ongota", "Oyda",
    "Pashto", "Polish", "Portuguese", "Punjabi", "Qimant", "Romanian", "Russian", "Saho", "Serbo-Croatian", "Shekkacho",
    "Sheko", "Shona", "Sidama", "Silt'e", "Sindhi", "Sinhala", "Somali", "Spanish", "Sundanese", "Suri",
    "Swedish", "Tagalog", "Tamil", "Telugu", "Thai", "Tigrinya", "Tirmaga", "Tsamai", "Turkish", "Ukrainian",
    "Urdu", "Uzbek", "Vietnamese", "Walayta", "Werji", "Xamtanga", "Yem", "Yoruba", "Zay", "Zayse", "Zulu"
];

function addLanguage() {
    const container = document.getElementById('languagesList');
    
    const languageOptions = worldLanguages.map(lang => 
        `<div class="dropdown-item" onclick="selectLanguage('${lang.replace(/'/g, "\\'")}')">${lang}</div>`
    ).join('');
    
    const formHTML = `
        <div class="inline-form" id="languageForm">
            <h4>Add Language</h4>
            <div class="form-grid">
                <div class="form-group" style="grid-column: 1 / -1;">
                    <label>Language *</label>
                    <div class="searchable-select">
                        <input type="text" id="langSearch" placeholder="Search or select language..." autocomplete="off" oninput="filterLanguages()" onfocus="showLanguageDropdown()" required>
                        <div id="languageDropdown" class="dropdown-list" style="display: none;">
                            ${languageOptions}
                            <div class="dropdown-item other-option" onclick="selectOtherLanguage()">
                                <strong>Other (Not Listed)</strong>
                            </div>
                        </div>
                    </div>
                    <input type="text" id="langOther" placeholder="Please specify language name" style="display: none; margin-top: 0.5rem;">
                    <input type="hidden" id="langName" required>
                </div>
                <div class="form-group">
                    <label>Proficiency Level *</label>
                    <select id="langProficiency" required>
                        <option value="">Select Level</option>
                        <option value="Basic">Basic (A1-A2)</option>
                        <option value="Intermediate">Intermediate (B1-B2)</option>
                        <option value="Advanced">Advanced (C1)</option>
                        <option value="Fluent">Fluent (C2)</option>
                        <option value="Native">Native Speaker</option>
                    </select>
                </div>
            </div>
            <div class="form-actions">
                <button type="button" class="btn-primary" onclick="saveLanguage()">Save</button>
                <button type="button" class="btn-secondary" onclick="cancelLanguage()">Cancel</button>
            </div>
        </div>
    `;
    
    container.insertAdjacentHTML('afterbegin', formHTML);
    document.getElementById('langSearch').focus();
    
    // Close dropdown when clicking outside
    document.addEventListener('click', closeLanguageDropdownOutside);
}

function showLanguageDropdown() {
    document.getElementById('languageDropdown').style.display = 'block';
}

function filterLanguages() {
    const searchValue = document.getElementById('langSearch').value.toLowerCase();
    const dropdown = document.getElementById('languageDropdown');
    const items = dropdown.querySelectorAll('.dropdown-item:not(.other-option)');
    
    let hasVisibleItems = false;
    items.forEach(item => {
        const text = item.textContent.toLowerCase();
        if (text.includes(searchValue)) {
            item.style.display = 'block';
            hasVisibleItems = true;
        } else {
            item.style.display = 'none';
        }
    });
    
    dropdown.style.display = 'block';
}

function selectLanguage(name) {
    document.getElementById('langSearch').value = name;
    document.getElementById('langName').value = name;
    document.getElementById('langOther').style.display = 'none';
    document.getElementById('languageDropdown').style.display = 'none';
}

function selectOtherLanguage() {
    document.getElementById('langSearch').value = 'Other';
    document.getElementById('langOther').style.display = 'block';
    document.getElementById('langOther').focus();
    document.getElementById('languageDropdown').style.display = 'none';
}

function closeLanguageDropdownOutside(e) {
    const dropdown = document.getElementById('languageDropdown');
    const searchInput = document.getElementById('langSearch');
    
    if (dropdown && searchInput && !dropdown.contains(e.target) && e.target !== searchInput) {
        dropdown.style.display = 'none';
    }
}

function saveLanguage() {
    let name = document.getElementById('langName').value.trim();
    const otherLanguage = document.getElementById('langOther');
    
    // If "Other" was selected, use the custom input value
    if (otherLanguage.style.display !== 'none' && otherLanguage.value.trim()) {
        name = otherLanguage.value.trim();
    }
    
    const proficiency = document.getElementById('langProficiency').value;
    
    if (!name || !proficiency) {
        alert('Please fill in all required fields');
        return;
    }
    
    languagesData.push({ name, proficiency });
    localStorage.setItem('languages', JSON.stringify(languagesData));
    
    document.removeEventListener('click', closeLanguageDropdownOutside);
    document.getElementById('languageForm').remove();
    loadLanguagesList();
}

function cancelLanguage() {
    document.removeEventListener('click', closeLanguageDropdownOutside);
    document.getElementById('languageForm').remove();
    loadLanguagesList();
}

function removeLanguage(index) {
    languagesData.splice(index, 1);
    localStorage.setItem('languages', JSON.stringify(languagesData));
    loadLanguagesList();
}

// Projects Management
let projectsData = JSON.parse(localStorage.getItem('projects') || '[]');

function loadProjectsList() {
    const container = document.getElementById('projectsList');
    if (!container) return;
    
    if (projectsData.length === 0) {
        container.innerHTML = '<p class="empty-state">No projects added yet.</p>';
        return;
    }
    
    container.innerHTML = projectsData.map((proj, index) => `
        <div class="list-item">
            <div class="list-item-header">
                <span class="list-item-title">${proj.title}</span>
                <button type="button" class="btn-remove" onclick="removeProject(${index})">Remove</button>
            </div>
            <p>${proj.bio}</p>
            ${proj.link ? `<a href="${proj.link}" target="_blank" style="color: var(--green);">View Project →</a>` : ''}
        </div>
    `).join('');
}

function addProject() {
    const container = document.getElementById('projectsList');
    
    const formHTML = `
        <div class="inline-form" id="projectForm">
            <h4>Add Project</h4>
            <div class="form-grid">
                <div class="form-group" style="grid-column: 1 / -1;">
                    <label>Project Title *</label>
                    <input type="text" id="projTitle" required>
                </div>
                <div class="form-group" style="grid-column: 1 / -1;">
                    <label>Project Description *</label>
                    <textarea id="projBio" rows="4" placeholder="Describe the project, your role, and technologies used..." required></textarea>
                </div>
                <div class="form-group" style="grid-column: 1 / -1;">
                    <label>Project Link (optional)</label>
                    <input type="url" id="projLink" placeholder="https://github.com/yourproject or https://yourproject.com">
                </div>
            </div>
            <div class="form-actions">
                <button type="button" class="btn-primary" onclick="saveProject()">Save</button>
                <button type="button" class="btn-secondary" onclick="cancelProject()">Cancel</button>
            </div>
        </div>
    `;
    
    container.insertAdjacentHTML('afterbegin', formHTML);
    document.getElementById('projTitle').focus();
}

function saveProject() {
    const title = document.getElementById('projTitle').value.trim();
    const bio = document.getElementById('projBio').value.trim();
    const link = document.getElementById('projLink').value.trim();
    
    if (!title || !bio) {
        alert('Please fill in all required fields');
        return;
    }
    
    projectsData.push({ title, bio, link });
    localStorage.setItem('projects', JSON.stringify(projectsData));
    
    document.getElementById('projectForm').remove();
    loadProjectsList();
}

function cancelProject() {
    document.getElementById('projectForm').remove();
    loadProjectsList();
}

function removeProject(index) {
    projectsData.splice(index, 1);
    localStorage.setItem('projects', JSON.stringify(projectsData));
    loadProjectsList();
}

// Certifications Management
let certificationsData = JSON.parse(localStorage.getItem('certifications') || '[]');

function loadCertificationsList() {
    const container = document.getElementById('certificationsList');
    if (!container) return;
    
    if (certificationsData.length === 0) {
        container.innerHTML = '<p class="empty-state">No certifications added yet.</p>';
        return;
    }
    
    container.innerHTML = certificationsData.map((cert, index) => `
        <div class="list-item">
            <div class="list-item-header">
                <span class="list-item-title">${cert.name}</span>
                <button type="button" class="btn-remove" onclick="removeCertification(${index})">Remove</button>
            </div>
            <div class="form-grid">
                <div><strong>Issued By:</strong> ${cert.issuer}</div>
                <div><strong>Issue Date:</strong> ${cert.issueDate}</div>
            </div>
        </div>
    `).join('');
}

function addCertification() {
    const container = document.getElementById('certificationsList');
    
    const formHTML = `
        <div class="inline-form" id="certificationForm">
            <h4>Add Certification</h4>
            <div class="form-grid">
                <div class="form-group" style="grid-column: 1 / -1;">
                    <label>Certification Name *</label>
                    <input type="text" id="certName" placeholder="e.g., AWS Certified Solutions Architect" required>
                </div>
                <div class="form-group">
                    <label>Issued By *</label>
                    <input type="text" id="certIssuer" placeholder="e.g., Amazon Web Services" required>
                </div>
                <div class="form-group">
                    <label>Issue Date *</label>
                    <input type="month" id="certDate" required>
                </div>
                <div class="form-group" style="grid-column: 1 / -1;">
                    <label>Credential ID (optional)</label>
                    <input type="text" id="certID" placeholder="Certificate ID or License Number">
                </div>
                <div class="form-group" style="grid-column: 1 / -1;">
                    <label>Credential URL (optional)</label>
                    <input type="url" id="certURL" placeholder="https://verify.certification.com/...">
                </div>
            </div>
            <div class="form-actions">
                <button type="button" class="btn-primary" onclick="saveCertification()">Save</button>
                <button type="button" class="btn-secondary" onclick="cancelCertification()">Cancel</button>
            </div>
        </div>
    `;
    
    container.insertAdjacentHTML('afterbegin', formHTML);
    document.getElementById('certName').focus();
}

function saveCertification() {
    const name = document.getElementById('certName').value.trim();
    const issuer = document.getElementById('certIssuer').value.trim();
    const issueDate = document.getElementById('certDate').value;
    const credentialId = document.getElementById('certID').value.trim();
    const credentialUrl = document.getElementById('certURL').value.trim();
    
    if (!name || !issuer || !issueDate) {
        alert('Please fill in all required fields');
        return;
    }
    
    certificationsData.push({ name, issuer, issueDate, credentialId, credentialUrl });
    localStorage.setItem('certifications', JSON.stringify(certificationsData));
    
    document.getElementById('certificationForm').remove();
    loadCertificationsList();
}

function cancelCertification() {
    document.getElementById('certificationForm').remove();
    loadCertificationsList();
}

function removeCertification(index) {
    certificationsData.splice(index, 1);
    localStorage.setItem('certifications', JSON.stringify(certificationsData));
    loadCertificationsList();
}


// References Management
let referencesData = JSON.parse(localStorage.getItem('references') || '[]');

function loadReferencesList() {
    const container = document.getElementById('referencesList');
    if (!container) return;
    
    if (referencesData.length === 0) {
        container.innerHTML = '<p class="empty-state">No references added yet.</p>';
        return;
    }
    
    container.innerHTML = referencesData.map((ref, index) => `
        <div class="list-item">
            <div class="list-item-header">
                <span class="list-item-title">${ref.name}</span>
                <button type="button" class="btn-remove" onclick="removeReference(${index})">Remove</button>
            </div>
            <div class="form-grid">
                <div><strong>Position:</strong> ${ref.position}</div>
                <div><strong>Organization:</strong> ${ref.organization}</div>
                <div><strong>Phone:</strong> ${ref.phone}</div>
                <div><strong>Email:</strong> ${ref.email}</div>
            </div>
        </div>
    `).join('');
}

function addReference() {
    const container = document.getElementById('referencesList');
    
    const formHTML = `
        <div class="inline-form" id="referenceForm">
            <h4>Add Reference</h4>
            <div class="form-grid">
                <div class="form-group" style="grid-column: 1 / -1;">
                    <label>Full Name *</label>
                    <input type="text" id="refName" placeholder="e.g., Dr. John Smith" required>
                </div>
                <div class="form-group">
                    <label>Position / Title *</label>
                    <input type="text" id="refPosition" placeholder="e.g., Senior Manager" required>
                </div>
                <div class="form-group">
                    <label>Organization / Company *</label>
                    <input type="text" id="refOrganization" placeholder="e.g., ABC Corporation" required>
                </div>
                <div class="form-group">
                    <label>Phone Number *</label>
                    <div class="phone-input-group">
                        <select id="refPhoneCountryCode" class="country-code-select" required>
                            <!-- Options will be populated by JavaScript -->
                        </select>
                        <input type="tel" id="refPhone" placeholder="912345678" required>
                    </div>
                </div>
                <div class="form-group">
                    <label>Email Address *</label>
                    <input type="email" id="refEmail" placeholder="reference@example.com" required>
                </div>
                <div class="form-group" style="grid-column: 1 / -1;">
                    <label>Relationship (optional)</label>
                    <input type="text" id="refRelationship" placeholder="e.g., Former Supervisor, Professor">
                </div>
            </div>
            <div class="form-actions">
                <button type="button" class="btn-primary" onclick="saveReference()">Save</button>
                <button type="button" class="btn-secondary" onclick="cancelReference()">Cancel</button>
            </div>
        </div>
    `;
    
    container.insertAdjacentHTML('afterbegin', formHTML);
    
    // Populate phone country code for reference
    const refPhoneCountryCode = document.getElementById('refPhoneCountryCode');
    if (refPhoneCountryCode && typeof countriesData !== 'undefined') {
        countriesData.forEach(country => {
            const option = document.createElement('option');
            option.value = country.code;
            option.textContent = `${country.flag} ${country.dialCode}`;
            refPhoneCountryCode.appendChild(option);
        });
        refPhoneCountryCode.value = 'ET'; // Default to Ethiopia
    }
    
    document.getElementById('refName').focus();
}

function saveReference() {
    const name = document.getElementById('refName').value.trim();
    const position = document.getElementById('refPosition').value.trim();
    const organization = document.getElementById('refOrganization').value.trim();
    const phoneCountryCode = document.getElementById('refPhoneCountryCode');
    const phoneNumber = document.getElementById('refPhone').value.trim();
    const email = document.getElementById('refEmail').value.trim();
    const relationship = document.getElementById('refRelationship').value.trim();
    
    if (!name || !position || !organization || !phoneNumber || !email) {
        alert('Please fill in all required fields');
        return;
    }
    
    // Get dial code from selected country
    const selectedOption = phoneCountryCode.options[phoneCountryCode.selectedIndex];
    const dialCode = selectedOption.textContent.split(' ')[1]; // Extract dial code
    const phone = `${dialCode} ${phoneNumber}`;
    
    referencesData.push({ name, position, organization, phone, email, relationship });
    localStorage.setItem('references', JSON.stringify(referencesData));
    
    document.getElementById('referenceForm').remove();
    loadReferencesList();
}

function cancelReference() {
    document.getElementById('referenceForm').remove();
    loadReferencesList();
}

function removeReference(index) {
    referencesData.splice(index, 1);
    localStorage.setItem('references', JSON.stringify(referencesData));
    loadReferencesList();
}


// Handle Profile Image Upload
function handleProfileImageUpload(event) {
    const file = event.target.files[0];
    
    if (file) {
        // Check file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            alert('Image size should be less than 5MB');
            return;
        }
        
        // Check file type
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file');
            return;
        }
        
        const reader = new FileReader();
        
        reader.onload = function(e) {
            const imageData = e.target.result;
            
            // Update profile image
            const profileImage = document.getElementById('profileImage');
            const userInitials = document.getElementById('userInitials');
            
            if (profileImage && userInitials) {
                profileImage.src = imageData;
                profileImage.style.display = 'block';
                userInitials.style.display = 'none';
            }
            
            // Save to localStorage
            const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
            currentUser.profileImage = imageData;
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
        };
        
        reader.readAsDataURL(file);
    }
}

// Calculate age from birthday
function calculateAge(birthday) {
    if (!birthday) return null;
    const birthDate = new Date(birthday);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
}

// Calculate profile completion percentage
function calculateProfileCompletion() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
    const fields = [
        currentUser.name,
        currentUser.email,
        currentUser.phone,
        currentUser.city,
        currentUser.country,
        currentUser.title,
        currentUser.sex,
        currentUser.birthday,
        currentUser.profileImage
    ];
    
    const filledFields = fields.filter(field => field && field.trim && field.trim() !== '').length;
    const totalFields = fields.length;
    const percentage = Math.round((filledFields / totalFields) * 100);
    
    return percentage;
}

// Update profile completion bar
function updateProfileCompletion() {
    const percentage = calculateProfileCompletion();
    const completionPercent = document.getElementById('completionPercent');
    const completionBar = document.getElementById('completionBar');
    
    if (completionPercent) {
        completionPercent.textContent = percentage;
    }
    
    if (completionBar) {
        completionBar.style.width = percentage + '%';
    }
}

// Load and display all profile information
function loadProfileHeader() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
    
    // Profile Image
    if (currentUser.profileImage) {
        const profileImage = document.getElementById('profileImage');
        const userInitials = document.getElementById('userInitials');
        
        if (profileImage && userInitials) {
            profileImage.src = currentUser.profileImage;
            profileImage.style.display = 'block';
            userInitials.style.display = 'none';
        }
    }
    
    // Check if personal information is filled
    const fullName = currentUser.fullName || currentUser.name || '';
    const hasValidName = fullName && !fullName.includes('@');
    const hasEmail = currentUser.email && currentUser.email.includes('@');
    const hasPhone = currentUser.phone;
    const hasCity = currentUser.city;
    const hasCountry = currentUser.country;
    
    // Personal info is considered filled if at least name, email, phone, city, and country are provided
    const isPersonalInfoFilled = hasValidName && hasEmail && hasPhone && hasCity && hasCountry;
    
    // Full Name - Always visible
    const displayFullName = document.getElementById('displayFullName');
    if (displayFullName) {
        if (hasValidName) {
            displayFullName.textContent = fullName;
        } else {
            displayFullName.textContent = 'Not Set';
        }
    }
    
    // Get all detail items except Name (which should always be visible)
    const detailItems = document.querySelectorAll('.profile-detail-item');
    
    // Hide or show detail items based on personal info completion
    detailItems.forEach(item => {
        const label = item.querySelector('.detail-label');
        if (label && label.textContent.toLowerCase() !== 'name') {
            if (isPersonalInfoFilled) {
                item.style.display = 'flex';
            } else {
                item.style.display = 'none';
            }
        }
    });
    
    // Only update values if personal info is filled
    if (isPersonalInfoFilled) {
        // Gender
        const displayGender = document.getElementById('displayGender');
        if (displayGender) {
            displayGender.textContent = currentUser.sex || 'Not Set';
        }
        
        // Age
        const displayAge = document.getElementById('displayAge');
        if (displayAge) {
            const age = calculateAge(currentUser.birthday);
            displayAge.textContent = age ? `${age} years` : 'Not Set';
        }
        
        // Email
        const displayEmail = document.getElementById('displayEmail');
        if (displayEmail) {
            displayEmail.textContent = currentUser.email || 'Not Set';
        }
        
        // Phone
        const displayPhone = document.getElementById('displayPhone');
        if (displayPhone) {
            displayPhone.textContent = currentUser.phone || 'Not Set';
        }
        
        // City
        const displayCity = document.getElementById('displayCity');
        if (displayCity) {
            displayCity.textContent = currentUser.city || 'Not Set';
        }
        
        // Country
        const displayCountry = document.getElementById('displayCountry');
        if (displayCountry) {
            displayCountry.textContent = currentUser.country || 'Not Set';
        }
        
        // Profession
        const displayProfession = document.getElementById('displayProfession');
        if (displayProfession) {
            displayProfession.textContent = currentUser.title || 'Not Set';
        }
        
        // Years of Experience
        const displayExperience = document.getElementById('displayExperience');
        if (displayExperience) {
            const years = currentUser.yearsOfExperience;
            if (years) {
                displayExperience.textContent = years + (years == 1 ? ' year' : ' years');
            } else {
                displayExperience.textContent = 'Not Set';
            }
        }
    }
    
    // Update profile completion
    updateProfileCompletion();
}

// Load profile header on page load
document.addEventListener('DOMContentLoaded', function() {
    loadProfileHeader();
});


// Scroll to section function
function scrollToSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        
        // Update active nav item
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });
        
        const activeNavItem = document.querySelector(`[onclick="scrollToSection('${sectionId}')"]`);
        if (activeNavItem) {
            activeNavItem.classList.add('active');
        }
    }
    return false; // Prevent default anchor behavior
}

// Intersection Observer to update active nav on scroll
document.addEventListener('DOMContentLoaded', function() {
    const sections = document.querySelectorAll('.form-section[id]');
    const navItems = document.querySelectorAll('.nav-item');
    
    const observerOptions = {
        root: null,
        rootMargin: '-100px 0px -60% 0px',
        threshold: 0
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const sectionId = entry.target.id;
                navItems.forEach(item => {
                    item.classList.remove('active');
                    if (item.getAttribute('onclick')?.includes(sectionId)) {
                        item.classList.add('active');
                    }
                });
            }
        });
    }, observerOptions);
    
    sections.forEach(section => {
        observer.observe(section);
    });
});
