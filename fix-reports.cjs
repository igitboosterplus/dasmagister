const fs = require('fs');

let content = fs.readFileSync('src/pages/Reports.tsx', 'utf8');

content = content.replace(
    "import { useAuth } from '@/hooks/useAuth';",
    "import { useAuth } from '@/hooks/useAuth';\nimport { useToast } from '@/hooks/use-toast';"
);

content = content.replace(
    "const [reports, setReports] = useState<Report[]>([]);",
    "const { toast } = useToast();\n  const [reports, setReports] = useState<Report[]>([]);"
);

content = content.replace(/alert\(\s*(.*?)\s*(?:,\s*)?\);/gs, (match, p1) => {
    return `toast({
        title: 'Notification',
        description: ${p1}
      });`;
});

fs.writeFileSync('src/pages/Reports.tsx', content, 'utf8');
console.log('Replaced successfully');
