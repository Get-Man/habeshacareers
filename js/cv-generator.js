// CV Generator - Academic/Technical CV Format

// Generate CV from profile data
function generateCV() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    
    // Check if at least basic information exists
    if (!currentUser || !currentUser.fullName) {
        alert('Please add at least your name in the personal information section before generating a CV.');
        return;
    }
    
    // Warn if profile is incomplete but allow generation
    const hasEmail = currentUser.email;
    const hasPhone = currentUser.phone;
    
    if (!hasEmail || !hasPhone) {
        const proceed = confirm('Your profile is incomplete. The CV will be generated with available information. Do you want to continue?');
        if (!proceed) return;
    }
    
    // Generate CV HTML
    const cvHTML = generateCVHTML(currentUser);
    
    // Create a new window for printing/downloading
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>CV - ${currentUser.fullName}</title>
            <link rel="stylesheet" href="css/style.css">
            <link rel="stylesheet" href="css/cv-generator.css">
            <style>
                body { margin: 0; padding: 20px; background: #f0f0f0; }
                @media print {
                    body { background: white; padding: 0; }
                }
            </style>
        </head>
        <body>
            ${cvHTML}
            <script>
                window.onload = function() {
                    window.print();
                };
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

// Preview CV
function previewCV() {
    const currentUser = JSON.parse(localStorage.getItem('currentUser'));
    
    // Check if at least basic information exists
    if (!currentUser || !currentUser.fullName) {
        alert('Please add at least your name in the personal information section before previewing your CV.');
        return;
    }
    
    // Generate CV HTML
    const cvHTML = generateCVHTML(currentUser);
    
    // Show in modal
    document.getElementById('cvPreviewContent').innerHTML = cvHTML;
    document.getElementById('cvPreviewModal').style.display = 'flex';
}

// Close CV Preview
function closeCVPreview() {
    document.getElementById('cvPreviewModal').style.display = 'none';
}

// Download CV from preview
function downloadCVFromPreview() {
    generateCV();
}

// Generate CV HTML
function generateCVHTML(user) {
    const education = JSON.parse(localStorage.getItem('education') || '[]');
    const experience = JSON.parse(localStorage.getItem('experience') || '[]');
    const skills = JSON.parse(localStorage.getItem('skills') || '[]');
    const languages = JSON.parse(localStorage.getItem('languages') || '[]');
    const projects = JSON.parse(localStorage.getItem('projects') || '[]');
    const certifications = JSON.parse(localStorage.getItem('certifications') || '[]');
    const references = JSON.parse(localStorage.getItem('references') || '[]');
    
    // Calculate age from birthday
    const age = user.birthday ? calculateAge(user.birthday) : '';
    
    // Get initials for photo placeholder
    const initials = getInitials(user.fullName || 'User');
    
    return `
        <div class="cv-document">
            <!-- Header with Photo -->
            <div class="cv-header">
                <div class="cv-photo">
                    ${user.profileImage ? `<img src="${user.profileImage}" alt="${user.fullName}">` : initials}
                </div>
                <div class="cv-header-info">
                    <h1>${user.fullName || 'Your Name'}</h1>
                    <h2>${user.title || 'Professional Title'}</h2>
                    <div class="cv-contact-info">
                        <div class="cv-contact-item"><strong>Email:</strong> ${user.email || ''}</div>
                        <div class="cv-contact-item"><strong>Phone:</strong> ${user.phone || ''}</div>
                        <div class="cv-contact-item"><strong>Location:</strong> ${user.city || ''}, ${user.country || ''}</div>
                        <div class="cv-contact-item"><strong>Date of Birth:</strong> ${formatDate(user.birthday) || 'N/A'}</div>
                        ${user.address ? `<div class="cv-contact-item"><strong>Address:</strong> ${user.address}</div>` : ''}
                        ${age ? `<div class="cv-contact-item"><strong>Age:</strong> ${age} years</div>` : ''}
                    </div>
                </div>
            </div>
            
            <!-- Professional Summary -->
            ${user.bio ? `
            <div class="cv-section">
                <h3 class="cv-section-title">Professional Summary</h3>
                <p style="text-align: justify;">${user.bio}</p>
            </div>
            ` : ''}
            
            <!-- Work Experience -->
            ${experience.length > 0 ? `
            <div class="cv-section">
                <h3 class="cv-section-title">Work Experience</h3>
                ${experience.map(exp => `
                    <div class="cv-entry">
                        <div class="cv-entry-header">
                            <div class="cv-entry-title">${exp.position || 'Position'}</div>
                            <div class="cv-entry-date">${formatDate(exp.startDate)} - ${exp.current ? 'Present' : formatDate(exp.endDate)}</div>
                        </div>
                        <div class="cv-entry-subtitle">${exp.company || 'Company'} | ${exp.location || ''}</div>
                        ${exp.description ? `
                            <div class="cv-entry-description">
                                <p>${exp.description}</p>
                            </div>
                        ` : ''}
                    </div>
                `).join('')}
            </div>
            ` : ''}
            
            <!-- Education and Training -->
            ${education.length > 0 ? `
            <div class="cv-section">
                <h3 class="cv-section-title">Education and Training</h3>
                ${education.map(edu => `
                    <div class="cv-entry">
                        <div class="cv-entry-header">
                            <div class="cv-entry-title">${edu.degree || 'Degree'} in ${edu.field || 'Field of Study'}</div>
                            <div class="cv-entry-date">${formatDate(edu.startDate)} - ${formatDate(edu.endDate)}</div>
                        </div>
                        <div class="cv-entry-subtitle">${edu.institution || 'Institution'}</div>
                        ${edu.grade ? `<div style="margin-top: 0.3rem;"><strong>Grade:</strong> ${edu.grade}</div>` : ''}
                    </div>
                `).join('')}
            </div>
            ` : ''}
            
            <!-- Language Skills -->
            ${languages.length > 0 ? `
            <div class="cv-section">
                <h3 class="cv-section-title">Language Skills</h3>
                <div class="cv-language-grid">
                    ${languages.map(lang => `
                        <div class="cv-language-item">
                            <span class="cv-language-name">${lang.language || 'Language'}</span>
                            <span class="cv-language-level">${lang.proficiency || 'Level'}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
            ` : ''}
            
            <!-- Skills -->
            ${skills.length > 0 ? `
            <div class="cv-section">
                <h3 class="cv-section-title">Technical Skills</h3>
                <div class="cv-skills-grid">
                    ${skills.map(skill => `
                        <div class="cv-skill-item">${skill}</div>
                    `).join('')}
                </div>
            </div>
            ` : ''}
            
            <!-- Trainings and Certifications -->
            ${certifications.length > 0 ? `
            <div class="cv-section">
                <h3 class="cv-section-title">Trainings and Certifications</h3>
                ${certifications.map(cert => `
                    <div class="cv-entry">
                        <div class="cv-entry-header">
                            <div class="cv-entry-title">${cert.name || 'Certification'}</div>
                            <div class="cv-entry-date">${formatDate(cert.date)}</div>
                        </div>
                        <div class="cv-entry-subtitle">${cert.organization || 'Organization'}</div>
                        ${cert.description ? `
                            <div class="cv-entry-description">
                                <p>${cert.description}</p>
                            </div>
                        ` : ''}
                        ${cert.url ? `<div style="margin-top: 0.3rem;"><strong>Certificate URL:</strong> <a href="${cert.url}" target="_blank">${cert.url}</a></div>` : ''}
                    </div>
                `).join('')}
            </div>
            ` : ''}
            
            <!-- Portfolio & Projects -->
            ${projects.length > 0 ? `
            <div class="cv-section">
                <h3 class="cv-section-title">Key Achievements & Projects</h3>
                ${projects.map(project => `
                    <div class="cv-entry">
                        <div class="cv-entry-header">
                            <div class="cv-entry-title">${project.name || 'Project'}</div>
                            <div class="cv-entry-date">${formatDate(project.date)}</div>
                        </div>
                        ${project.description ? `
                            <div class="cv-entry-description">
                                <p style="text-align: justify;">${project.description}</p>
                            </div>
                        ` : ''}
                        ${project.url ? `<div style="margin-top: 0.3rem;"><strong>Project URL:</strong> <a href="${project.url}" target="_blank">${project.url}</a></div>` : ''}
                    </div>
                `).join('')}
            </div>
            ` : ''}
            
            <!-- Extracurricular Activities -->
            ${user.activities ? `
            <div class="cv-section">
                <h3 class="cv-section-title">Extracurricular Activities</h3>
                <p style="text-align: justify;">${user.activities}</p>
            </div>
            ` : ''}
            
            <!-- References -->
            ${references.length > 0 ? `
            <div class="cv-section">
                <h3 class="cv-section-title">References</h3>
                ${references.map(ref => `
                    <div class="cv-entry">
                        <div class="cv-entry-title">${ref.name || 'Name'}</div>
                        <div style="margin-top: 0.3rem;">
                            <strong>Position:</strong> ${ref.position || 'Position'}<br>
                            <strong>Organization:</strong> ${ref.organization || 'Organization'}<br>
                            <strong>Phone:</strong> ${ref.phone || 'N/A'}<br>
                            <strong>Email:</strong> ${ref.email || 'N/A'}
                        </div>
                    </div>
                `).join('')}
            </div>
            ` : ''}
            
            <!-- Footer -->
            <div style="margin-top: 3rem; padding-top: 1rem; border-top: 2px solid #e0e0e0; text-align: center; font-size: 0.85rem; color: #666;">
                <p>Generated on ${new Date().toLocaleDateString('en-GB')} via Habesha Career Platform</p>
            </div>
        </div>
    `;
}

// Helper function to format dates
function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Helper function to calculate age
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

// Helper function to get initials
function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

// Handle CV Upload from Computer
function handleCVUpload(event) {
    const file = event.target.files[0];
    
    if (!file) return;
    
    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
        alert('File size should be less than 5MB');
        return;
    }
    
    // Validate file type
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowedTypes.includes(file.type)) {
        alert('Only PDF, DOC, and DOCX files are allowed');
        return;
    }
    
    // Save file info to localStorage
    const uploadedCVs = JSON.parse(localStorage.getItem('uploadedCVs') || '[]');
    
    const cvData = {
        id: Date.now(),
        name: file.name,
        size: formatFileSize(file.size),
        type: file.type,
        source: 'computer',
        uploadDate: new Date().toISOString()
    };
    
    uploadedCVs.push(cvData);
    localStorage.setItem('uploadedCVs', JSON.stringify(uploadedCVs));
    
    // Display uploaded CV
    displayUploadedCVs();
    
    alert('CV uploaded successfully from your computer!');
    
    // Reset file input
    event.target.value = '';
}

// Upload from Google Drive
function uploadFromGoogleDrive() {
    // Google Drive Picker API integration
    // Note: This requires Google API credentials and setup
    
    // For now, show instructions
    const useGoogleDrive = confirm(
        'Google Drive Integration:\n\n' +
        'To upload from Google Drive, you need to:\n' +
        '1. Sign in to your Google account\n' +
        '2. Select your CV file from Google Drive\n' +
        '3. Grant permission to access the file\n\n' +
        'Would you like to proceed with Google Drive upload?\n\n' +
        'Note: This feature requires Google API setup. For now, you can:\n' +
        '- Download your CV from Google Drive to your computer\n' +
        '- Then use "From Computer" option to upload it'
    );
    
    if (useGoogleDrive) {
        // Open Google Drive picker (simplified version)
        openGoogleDrivePicker();
    }
}

// Open Google Drive Picker (Simplified)
function openGoogleDrivePicker() {
    // This is a simplified implementation
    // In production, you would use Google Picker API
    
    alert(
        'Google Drive Integration Setup:\n\n' +
        'To enable Google Drive uploads, the administrator needs to:\n\n' +
        '1. Create a Google Cloud Project\n' +
        '2. Enable Google Drive API\n' +
        '3. Enable Google Picker API\n' +
        '4. Create OAuth 2.0 credentials\n' +
        '5. Add the API keys to the application\n\n' +
        'For now, please:\n' +
        '1. Go to drive.google.com\n' +
        '2. Download your CV file\n' +
        '3. Use "From Computer" option to upload it\n\n' +
        'We are working on direct Google Drive integration!'
    );
    
    // Alternative: Open Google Drive in new tab
    const openDrive = confirm('Would you like to open Google Drive to download your CV?');
    if (openDrive) {
        window.open('https://drive.google.com', '_blank');
    }
}

// Display uploaded CVs
function displayUploadedCVs() {
    const uploadedCVs = JSON.parse(localStorage.getItem('uploadedCVs') || '[]');
    const container = document.getElementById('uploadedCVList');
    
    if (!container) return;
    
    if (uploadedCVs.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    container.innerHTML = uploadedCVs.map(cv => `
        <div class="uploaded-cv-item">
            <div class="uploaded-cv-info">
                <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                    <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
                </svg>
                <div>
                    <div class="uploaded-cv-name">${cv.name}</div>
                    <div class="uploaded-cv-size">
                        ${cv.size} • ${cv.source === 'google-drive' ? '☁️ Google Drive' : '💻 Computer'} • ${new Date(cv.uploadDate).toLocaleDateString()}
                    </div>
                </div>
            </div>
            <div class="uploaded-cv-actions">
                <button class="btn-icon" onclick="deleteUploadedCV(${cv.id})" title="Delete">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                    </svg>
                </button>
            </div>
        </div>
    `).join('');
}

// Delete uploaded CV
function deleteUploadedCV(id) {
    if (!confirm('Are you sure you want to delete this CV?')) return;
    
    const uploadedCVs = JSON.parse(localStorage.getItem('uploadedCVs') || '[]');
    const filtered = uploadedCVs.filter(cv => cv.id !== id);
    localStorage.setItem('uploadedCVs', JSON.stringify(filtered));
    
    displayUploadedCVs();
}

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Load uploaded CVs on page load
document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('uploadedCVList')) {
        displayUploadedCVs();
    }
});
