const fs = require('fs');

function processFile(filePath, componentName) {
    let content = fs.readFileSync(filePath, 'utf8');
    let count = 0;

    // Check if useToast is imported
    if (!content.includes('useToast')) {
        content = content.replace(
            "import { useAuth } from '@/hooks/useAuth'",
            "import { useAuth } from '@/hooks/useAuth'\nimport { useToast } from '@/hooks/use-toast'"
        );

        const hookRegex = new RegExp(`export default function ${componentName}\\(\\) \\{`);
        content = content.replace(hookRegex, `export default function ${componentName}() {\n  const { toast } = useToast()`);
    }

    content = content.replace(/alert\(\s*(.*?)\s*(?:,\s*)?\)/gs, (match, p1) => {
        count++;
        // Use variant destr for errors if it implies error
        const isError = p1.toLowerCase().includes('impossible') || p1.toLowerCase().includes('erreur') || p1.toLowerCase().includes('non authentifié');
        const variant = isError ? "variant: 'destructive'," : "";
        const title = isError ? "'Erreur'" : "'Information'";
        return `toast({\n        title: ${title},\n        description: ${p1},\n        ${variant}\n      })`;
    });

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Replaced ${count} alerts in ${filePath}`);
}

processFile('src/pages/Reports/Admin.tsx', 'AdminReports');
processFile('src/pages/Reports/Employer.tsx', 'EmployerReports');
