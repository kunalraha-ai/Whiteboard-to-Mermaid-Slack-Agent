const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generate a beautifully formatted PDF document for architecture documentation.
 *
 * @param {object} params
 * @param {object} params.docs            - The documentation JSON object from Azure OpenAI.
 * @param {string} params.docs.overview   - High-level overview.
 * @param {Array<{ name: string, responsibility: string, dependencies: string[] }>} params.docs.components - Components list.
 * @param {string} params.docs.failurePoints - Failure points and modes.
 * @param {string} params.docs.scalingStrategy - Scaling recommendations.
 * @param {string} params.pdfPath         - Target file path for the output PDF.
 * @returns {Promise<void>} Resolves when the PDF file has been fully written.
 */
function generatePdfDocumentation({ docs, pdfPath }) {
  return new Promise((resolve, reject) => {
    // Enable bufferPages so we can compute total page count for footers in a second pass
    const doc = new PDFDocument({ margin: 50, bufferPages: true });
    const writeStream = fs.createWriteStream(pdfPath);

    doc.pipe(writeStream);

    // Color Palette
    const PRIMARY_COLOR = '#1e293b'; // Deep Slate
    const SECONDARY_COLOR = '#3b82f6'; // Accent Blue
    const TEXT_COLOR = '#334155'; // Charcoal Body
    const BORDER_COLOR = '#e2e8f0'; // Light Gray border

    // Helper: Render multiline bullet-point strings
    function renderBulletPoints(textStr) {
      if (!textStr) return;
      const lines = textStr.split('\n')
                           .map(l => l.trim().replace(/^[•\-\*\s]+/, '').trim())
                           .filter(l => l.length > 0);
      
      lines.forEach(line => {
        doc.fontSize(10)
           .fillColor(TEXT_COLOR)
           .text(`•  ${line}`, { paragraphGap: 6, lineGap: 2 });
      });
    }

    // ==========================================
    // DOCUMENT LAYOUT (Continuous Flow)
    // ==========================================
    
    // Header Title
    doc.fontSize(22)
       .fillColor(PRIMARY_COLOR)
       .text('Architecture Documentation', { paragraphGap: 4 });

    doc.fontSize(9)
       .fillColor('#64748b')
       .text(`Generated on ${new Date().toLocaleDateString()}`);

    // Horizontal Divider Rule
    doc.moveTo(50, 90)
       .lineTo(562, 90)
       .strokeColor(BORDER_COLOR)
       .lineWidth(1)
       .stroke();

    doc.moveDown(2);

    // Section 1: Overview
    doc.fontSize(14)
       .fillColor(PRIMARY_COLOR)
       .text('1. System Overview', { paragraphGap: 8 });

    renderBulletPoints(docs.overview);
    doc.moveDown(1.5);

    // Section 2: Component Catalog
    doc.fontSize(14)
       .fillColor(PRIMARY_COLOR)
       .text('2. Component Catalog', { paragraphGap: 10 });

    if (docs.components && docs.components.length > 0) {
      docs.components.forEach((comp) => {
        // Component Title
        doc.fontSize(11)
           .fillColor(SECONDARY_COLOR)
           .text(comp.name || 'Unnamed Component', { paragraphGap: 3 });

        // Responsibility
        doc.fontSize(10)
           .fillColor(TEXT_COLOR)
           .text(`Responsibility: ${comp.responsibility || 'None specified'}`, { indent: 15, paragraphGap: 2 });

        // Dependencies
        if (comp.dependencies && comp.dependencies.length > 0) {
          const deps = Array.isArray(comp.dependencies) ? comp.dependencies.join(', ') : comp.dependencies;
          doc.fontSize(9)
             .fillColor('#64748b')
             .text(`Dependencies: ${deps}`, { indent: 15, paragraphGap: 8 });
        } else {
          doc.fontSize(9)
             .fillColor('#64748b')
             .text('Dependencies: None', { indent: 15, paragraphGap: 8 });
        }
      });
    } else {
      doc.fontSize(10)
         .fillColor(TEXT_COLOR)
         .text('No components cataloged.');
    }
    doc.moveDown(1.5);

    // Section 3: Failure Points
    doc.fontSize(14)
       .fillColor(PRIMARY_COLOR)
       .text('3. Failure Modes & Points of Failure', { paragraphGap: 8 });

    renderBulletPoints(docs.failurePoints);
    doc.moveDown(1.5);

    // Section 4: Scaling Strategy
    doc.fontSize(14)
       .fillColor(PRIMARY_COLOR)
       .text('4. Scaling & Growth Strategy', { paragraphGap: 8 });

    renderBulletPoints(docs.scalingStrategy);

    // ==========================================
    // SECOND PASS: Page Numbers & Footers
    // ==========================================
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      
      // Draw footer line
      doc.moveTo(50, 725)
         .lineTo(562, 725)
         .strokeColor(BORDER_COLOR)
         .lineWidth(0.5)
         .stroke();

      // Draw footer text
      doc.fontSize(8)
         .fillColor('#94a3b8')
         .text('Architecture Documentation', 50, 735, { align: 'left' })
         .text(`Page ${i + 1} of ${range.count}`, 50, 735, { align: 'right' });
    }

    // Finalize PDF Document
    doc.end();

    writeStream.on('finish', () => resolve());
    writeStream.on('error', (err) => reject(err));
  });
}

module.exports = {
  generatePdfDocumentation
};
