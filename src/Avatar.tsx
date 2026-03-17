import React, { useState } from 'react';
import { User } from '@supabase/supabase-js'; 

interface AvatarProps {
  user: User;
  className?: string;
}

const Avatar: React.FC<AvatarProps> = ({ user, className = 'h-10 w-10' }) => {
  const [imageError, setImageError] = useState(false);
  const avatarUrl = user.user_metadata?.avatar_url;
  const fullName = user.user_metadata?.full_name;
  const email = user.email;

  // Gera uma cor de fundo consistente baseada no ID do usuário
  const generateColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const color = `hsl(${hash % 360}, 50%, 40%)`;
    return color;
  };

  const getInitials = () => {
    if (fullName) {
      const names = fullName.split(' ');
      return names.length > 1 ? `${names[0][0]}${names[names.length - 1][0]}` : names[0].substring(0, 2);
    }
    if (email) {
      return email.substring(0, 2).toUpperCase();
    }
    return 'U';
  };

  // Tenta renderizar a imagem apenas se a URL existir E não tiver ocorrido um erro
  if (avatarUrl && !imageError) {
    return (
      <img 
        src={avatarUrl} 
        alt={fullName || 'Avatar'} 
        className={`rounded-full object-cover ${className}`} 
        onError={() => setImageError(true)} // Se a imagem falhar ao carregar, atualiza o estado
      />
    );
  }

  return (
    <div style={{ backgroundColor: generateColor(user.id) }} className={`flex items-center justify-center rounded-full font-bold text-white ${className}`}>
      {getInitials()}
    </div>
  );
};

export default Avatar;