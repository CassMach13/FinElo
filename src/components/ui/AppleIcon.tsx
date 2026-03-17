import React from 'react';

const AppleIcon: React.FC<React.SVGProps<SVGSVGElement>> = ({ className, ...props }) => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor" // Usa a cor do texto do elemento pai
      className={className} // Permite passar classes de tamanho (ex: h-5 w-5)
      {...props}
    >
      {/* SVG do logo da Apple recriado para maior fidelidade visual */}
      <path d="M17.213 15.064c-.542 1.594-1.835 2.82-3.432 2.82-1.597 0-2.29-.938-3.756-.938-1.465 0-2.29.938-3.756.938-1.692 0-3.11-1.4-3.82-3.348C1.003 12.15.42 6.83 2.83 4.425c1.198-1.198 2.82-1.835 4.358-1.835 1.465 0 2.74.72 3.61.72.87 0 2.408-1.01 4.14-1.01 1.465 0 2.964.646 4.068.938-2.053 1.25-3.358 3.52-3.358 5.946 0 2.74 1.692 4.816 3.432 5.946a4.603 4.603 0 0 1-1.67 1.992z" />
      <path d="M13.82 2.448c-.073.002-1.465.86-1.465 2.48 0 1.764 1.12 2.552 1.39 2.552.073-.002 1.465-.86 1.465-2.48 0-1.764-1.12-2.552-1.39-2.552z" />
    </svg>
  );
};

export default AppleIcon;