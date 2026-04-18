import { useState, useEffect } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';

const API_URL = '/api';
const SOCKET_URL = '/';

const socket = io(SOCKET_URL);
const SESSION_ID = localStorage.getItem('session_id') || Math.random().toString(36).substring(2);
localStorage.setItem('session_id', SESSION_ID);

export default function App() {
  const [menfessList, setMenfessList] = useState([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  
  // Compose States
  const [content, setContent] = useState('');
  const [senderName, setSenderName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Interaction States
  const [likedPosts, setLikedPosts] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('likedPosts')) || [];
    } catch {
      return [];
    }
  });
  
  const [activeCommentId, setActiveCommentId] = useState(null);
  const [commentContent, setCommentContent] = useState('');
  const [hasScrolled, setHasScrolled] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const [isToastClosing, setIsToastClosing] = useState(false);
  const [currentView, setCurrentView] = useState('feed'); // feed, history, admin_login, admin_dashboard
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarClosing, setIsSidebarClosing] = useState(false);

  // Admin States
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [adminTab, setAdminTab] = useState('menfess'); // menfess, inbox
  const [contactMessages, setContactMessages] = useState([]);

  // Contact States
  const [contactEmail, setContactEmail] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [isContactSending, setIsContactSending] = useState(false);

  useEffect(() => {
    localStorage.setItem('likedPosts', JSON.stringify(likedPosts));
  }, [likedPosts]);

  useEffect(() => {
    // Setup Dark Mode toggle into HTML root element
    const root = window.document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDarkMode]);

  useEffect(() => {
    axios.get(`${API_URL}/menfess`)
      .then(res => setMenfessList(res.data))
      .catch(err => console.error("Failed to fetch feeds", err));

    socket.on('new_menfess', (newMenfess) => {
      setMenfessList(prev => [newMenfess, ...prev]);
    });

    socket.on('update_like', ({ menfess_id, count }) => {
      setMenfessList(prev => prev.map(m => 
        m.id == menfess_id ? { ...m, likes: count } : m
      ));
    });

    socket.on('new_comment', (newComment) => {
      setMenfessList(prev => prev.map(m => {
        if (m.id == newComment.menfess_id) {
          return { ...m, comments: [...(m.comments || []), newComment] };
        }
        return m;
      }));
    });

    socket.on('delete_menfess', (deletedId) => {
      setMenfessList(prev => prev.filter(m => m.id !== deletedId));
    });

    return () => {
      socket.off('new_menfess');
      socket.off('update_like');
      socket.off('new_comment');
      socket.off('delete_menfess');
    };
  }, []);

  useEffect(() => {
    if (menfessList.length > 0 && window.location.hash && !hasScrolled) {
      setTimeout(() => {
        const el = document.getElementById(window.location.hash.substring(1));
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-2', 'ring-[#ff0000]', 'ring-offset-4', 'dark:ring-offset-[#1f1f1f]');
          setTimeout(() => {
            el.classList.remove('ring-2', 'ring-[#ff0000]', 'ring-offset-4', 'dark:ring-offset-[#1f1f1f]');
          }, 2000);
          setHasScrolled(true);
        }
      }, 300);
    }
  }, [menfessList, hasScrolled]);

  const openComposeModal = () => {
    setContent('');
    setSenderName('');
    setErrorMsg('');
    setIsModalOpen(true);
  };

  const handleComposeSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg('');

    try {
      await axios.post(`${API_URL}/menfess`, {
        content,
        sender_name: senderName || 'Anonim',
        theme_color: isDarkMode ? '#262626' : '#ffffff',
        session_id: SESSION_ID,
      });
      setIsModalOpen(false);
    } catch (err) {
      if (err.response && err.response.data.error) {
        setErrorMsg(err.response.data.error);
      } else {
        setErrorMsg('Terjadi kesalahan, gagal mengirim pesan.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLike = async (id) => {
    try {
      if (likedPosts.includes(id)) {
        await axios.post(`${API_URL}/menfess/${id}/unlike`);
        setLikedPosts(prev => prev.filter(pId => pId !== id));
      } else {
        await axios.post(`${API_URL}/menfess/${id}/like`);
        setLikedPosts(prev => [...prev, id]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCommentSubmit = async (e, menfessId) => {
    e.preventDefault();
    if (!commentContent.trim()) return;

    try {
      await axios.post(`${API_URL}/menfess/${menfessId}/comments`, {
        content: commentContent,
        session_id: SESSION_ID
      });
      setCommentContent('');
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteMenfess = async (id) => {
    if (!window.confirm(`Yakin ingin melenyapkan pos ini selamanya dari basis data?`)) return;
    try {
      await axios.delete(`${API_URL}/menfess/${id}`, {
        headers: {
          'Authorization': adminPassword
        }
      });
      displayToast(`Pesan berhasil didemusnahkan.`);
    } catch (err) {
      displayToast('Gagal menghapus pesan, Otorisasi ditolak.');
    }
  };

  const handleShare = (unique_id) => {
    const url = `${window.location.origin}${window.location.pathname}#${unique_id}`;
    navigator.clipboard.writeText(url).then(() => {
      displayToast(`Tautan pesan #${unique_id} disalin ke papan klip!`);
    }).catch(() => {
      displayToast('Gagal menyalin tautan');
    });
  };

  const fetchContactMessages = async () => {
    try {
      const res = await axios.get(`${API_URL}/contact`, {
        headers: { 'Authorization': adminPassword }
      });
      setContactMessages(res.data);
    } catch (err) {
      console.error('Gagal mengambil pesan kontak:', err);
    }
  };

  const displayToast = (message) => {
    setToastMessage(message);
    setIsToastClosing(false);
    
    if (window.toastTimeout) clearTimeout(window.toastTimeout);
    if (window.toastCloseTimeout) clearTimeout(window.toastCloseTimeout);

    window.toastTimeout = setTimeout(() => {
      setIsToastClosing(true);
      window.toastCloseTimeout = setTimeout(() => {
        setToastMessage(null);
        setIsToastClosing(false);
      }, 300);
    }, 1700);
  };

  const closeSidebar = () => {
    if (isSidebarClosing) return;
    setIsSidebarClosing(true);
    setTimeout(() => {
      setIsSidebarOpen(false);
      setIsSidebarClosing(false);
    }, 280);
  };

  const timeAgo = (dateStr) => {
    const ms = new Date() - new Date(dateStr);
    const min = Math.floor(ms / 60000);
    if(min < 1) return 'Baru saja';
    if(min < 60) return `${min}m ago`;
    const hrs = Math.floor(min / 60);
    if(hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <div className="bg-white text-black dark:bg-[#0e0e0e] dark:text-white min-h-screen font-body pb-24 transition-colors duration-300">
      {/* TopAppBar */}
      <header className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-6 py-4 bg-white/80 dark:bg-[#0e0e0e]/80 backdrop-blur-md shadow-sm dark:shadow-none border-b border-gray-100 dark:border-transparent transition-colors duration-300">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="text-[#ff0000] hover:bg-gray-100 dark:hover:bg-[#1f1f1f] transition-colors p-2 rounded-lg active:scale-95 active:duration-150 flex items-center justify-center"
          >
            <span className="material-symbols-outlined">menu</span>
          </button>
          <h1 className="text-2xl font-black tracking-tighter drop-shadow-[0_0_4px_rgba(255,0,0,0.2)] dark:drop-shadow-[0_0_8px_rgba(255,0,0,0.4)] font-headline flex items-center gap-1">
            <span className="material-symbols-outlined text-[#ff0000] text-3xl">architecture</span>
            <span className="text-[#ff0000]">ARCHI</span>
            <span className="text-gray-900 dark:text-white">FES</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="text-[#ff0000] hover:bg-gray-100 dark:hover:bg-[#1f1f1f] transition-colors p-2 rounded-lg active:scale-95 active:duration-150 flex items-center justify-center"
          >
            <span className="material-symbols-outlined">
              {isDarkMode ? 'light_mode' : 'dark_mode'}
            </span>
          </button>
        </div>
      </header>

      {/* Toast Notification */}
      {toastMessage && (
        <div className={`fixed top-24 left-1/2 -translate-x-1/2 z-[70] bg-gray-900 dark:bg-white dark:text-gray-900 border border-gray-700 dark:border-gray-200 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center justify-center gap-3 ${isToastClosing ? 'overlay-leave' : 'animate-[fadeIn_0.3s_ease]'} text-sm font-bold font-headline w-max max-w-[90vw] transition-all text-center`}>
          <span className="material-symbols-outlined text-[#ff0000]" style={{ fontVariationSettings: "'FILL' 1" }}>info</span>
          <span className="truncate whitespace-normal">{toastMessage}</span>
        </div>
      )}
      
      {/* -------------------- USER VIEW (Feed/History) -------------------- */}
      {(currentView === 'feed' || currentView === 'history') && (
        <>
          <main className="pt-24 pb-32 px-4 md:px-8 max-w-4xl mx-auto">
            {/* Hero Branding Section */}
            {currentView === 'feed' && (
              <section className="mb-12">
                <h2 className="text-[3.5rem] font-extrabold tracking-tighter leading-none mb-4">Menfess-Nya <br/><span className="text-[#ff0000]">Arsitektur Unnes</span></h2>
                <p className="text-gray-600 dark:text-[#ababab] max-w-md text-lg transition-colors duration-300">Platform anonim bagi mahasiswa Arsitektur Unnes untuk berbagi cerita, pengalaman, dan pandangan secara bebas secara Anonim.</p>
              </section>
            )}

            {/* Feed List */}
            <div className="space-y-6">
              {menfessList.map((item) => {
                const isLiked = likedPosts.includes(item.id);
                const isCommentActive = activeCommentId === item.id;
                
                return (
                  <article id={item.unique_id} key={item.id} className={`bg-red-50/50 dark:bg-[#1f1f1f] border transition-all duration-300 rounded-xl shadow-md dark:shadow-2xl hover:bg-red-50 dark:hover:bg-[#262626] group menfess-card-enter overflow-hidden ${isCommentActive ? 'border-red-200 dark:border-[#570017]' : 'border-red-100 dark:border-transparent'}`}>
                    <div className="p-6">
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex items-center gap-2">
                           <span className="text-primary font-bold tracking-widest text-xs uppercase bg-[#ff0000]/10 px-3 py-1 rounded-full">{item.unique_id}</span>
                           {item.sender_name && item.sender_name !== 'Anonim' && (
                             <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Dari: {item.sender_name}</span>
                           )}
                        </div>
                        <span className="text-gray-500 dark:text-[#ababab] text-[10px] font-semibold uppercase tracking-widest">{timeAgo(item.created_at)}</span>
                      </div>
                      <p className="text-gray-900 dark:text-white text-lg leading-relaxed mb-6 font-medium whitespace-pre-wrap transition-colors duration-300">
                        {item.content}
                      </p>
                      <div className="flex items-center gap-6">
                        {/* Like Button */}
                        <button 
                          onClick={() => handleLike(item.id)}
                          className={`flex items-center gap-2 transition-colors group/btn active:scale-90 ${isLiked ? 'text-[#ff0000] dark:text-[#ff0000]' : 'text-gray-500 dark:text-[#ababab] hover:text-[#ff0000] dark:hover:text-[#ff0000]'}`}
                        >
                          <span 
                            className="material-symbols-outlined text-xl group-hover/btn:scale-110 transition-all duration-300"
                            style={isLiked ? { fontVariationSettings: "'FILL' 1" } : {}}
                          >favorite</span>
                          <span className="text-xs font-bold">{item.likes || 0}</span>
                        </button>
                        {/* Comment Button */}
                        <button 
                          onClick={() => setActiveCommentId(isCommentActive ? null : item.id)}
                          className={`flex items-center gap-2 transition-colors group/btn ${isCommentActive ? 'text-[#ff0000]' : 'text-gray-500 dark:text-[#ababab] hover:text-[#ff0000] dark:hover:text-[#ff0000]'}`}
                        >
                          <span 
                            className="material-symbols-outlined text-xl group-hover/btn:scale-110 transition-transform"
                            style={isCommentActive ? { fontVariationSettings: "'FILL' 1" } : {}}
                          >psychology</span>
                          <span className="text-xs font-bold">{item.comments?.length || 0}</span>
                        </button>
                        <button 
                          onClick={() => handleShare(item.unique_id)} 
                          className="ml-auto text-gray-500 dark:text-[#ababab] hover:text-[#ff0000] dark:hover:text-white transition-colors"
                        >
                          <span className="material-symbols-outlined">share</span>
                        </button>
                      </div>
                    </div>

                    {/* Comments Section */}
                    {isCommentActive && (
                      <div className="bg-white dark:bg-[#0e0e0e] border-t border-gray-100 dark:border-[#262626] p-6 pt-4 animate-[fadeIn_0.3s_ease]">
                        <div className="space-y-4 mb-4">
                          {(!item.comments || item.comments.length === 0) && (
                            <div className="text-sm font-semibold text-gray-400 dark:text-gray-500 italic">Belum ada balasan yang terekam.</div>
                          )}
                          
                          {item.comments && item.comments.map(c => (
                            <div key={c.id} className="bg-gray-50 dark:bg-[#1f1f1f] p-3 rounded-lg text-sm border border-gray-100 dark:border-transparent">
                              <div className="flex gap-2 items-center mb-1">
                                <span className="font-bold text-gray-900 dark:text-gray-200">
                                  {c.session_id === item.session_id ? 'Author' : 'Anon'}
                                </span>
                                {c.session_id === item.session_id && (
                                  <span className="material-symbols-outlined text-[#ff0000] text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                                )}
                                <span className="text-[10px] text-gray-400 font-semibold">{timeAgo(c.created_at)}</span>
                              </div>
                              <p className="text-gray-700 dark:text-gray-300">{c.content}</p>
                            </div>
                          ))}
                        </div>
                        
                        <form className="flex gap-2" onSubmit={(e) => handleCommentSubmit(e, item.id)}>
                          <input 
                            type="text" 
                            className="flex-1 bg-gray-50 text-gray-900 dark:bg-[#1a1a1a] dark:text-white border border-gray-200 dark:border-gray-800 focus:border-[#ff0000] focus:ring-1 focus:ring-[#ff0000] rounded-xl px-4 py-2 text-sm font-medium placeholder-gray-400 transition-colors" 
                            placeholder="Tulis balasan anonim..." 
                            value={commentContent}
                            onChange={e => setCommentContent(e.target.value)}
                          />
                          <button type="submit" className="bg-[#ff0000] text-black dark:text-[#490013] px-4 rounded-xl flex items-center justify-center hover:brightness-110 transition-transform active:scale-95">
                            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
                          </button>
                        </form>
                      </div>
                    )}
                  </article>
                );
              })}
              
              {menfessList.length === 0 && (
                 <div className="text-center mt-10 text-gray-400 dark:text-[#ababab]">Belum ada menfess saat ini.</div>
              )}
            </div>
          </main>

          {/* FAB */}
          <button 
            onClick={openComposeModal}
            className="fixed bottom-24 right-6 md:right-12 z-[60] bg-[#ff0000] text-black dark:text-[#490013] font-bold p-4 hover:px-6 hover:py-4 rounded-full shadow-[0_4px_20px_rgba(255,0,0,0.3)] flex items-center gap-0 hover:gap-3 active:scale-90 transition-all duration-300 hover:brightness-110 group hover:rounded-full"
          >
            <span className="material-symbols-outlined text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>add</span>
            <span className="uppercase tracking-widest text-sm max-w-0 overflow-hidden whitespace-nowrap group-hover:max-w-[200px] transition-all duration-300 ease-out opacity-0 group-hover:opacity-100">Tulis Menfess</span>
          </button>

          {/* BottomNavBar */}
          <nav className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-4 py-3 bg-white/80 dark:bg-[#0e0e0e]/80 backdrop-blur-xl shadow-[0_-10px_30px_rgba(0,0,0,0.1)] dark:shadow-[0_-10px_30px_rgba(0,0,0,0.5)] rounded-t-2xl border-t border-gray-200 dark:border-transparent transition-colors duration-300">
            <a 
              className={`flex flex-col items-center justify-center rounded-xl px-4 py-1 active:scale-90 active:duration-100 transition-all cursor-pointer ${currentView === 'feed' ? 'text-[#ff0000] bg-red-50 dark:bg-[#1f1f1f]' : 'text-gray-400 dark:text-[#ababab] hover:text-[#ff0000] dark:hover:text-white'}`} 
              onClick={() => setCurrentView('feed')}
            >
              <span className="material-symbols-outlined text-2xl">grid_view</span>
              <span className="font-headline text-[10px] font-semibold uppercase tracking-widest mt-1">Feed</span>
            </a>
            <a 
              className="flex flex-col items-center justify-center text-gray-400 dark:text-[#ababab] hover:text-[#ff0000] dark:hover:text-white transition-all active:scale-90 active:duration-100 cursor-pointer" 
              onClick={openComposeModal}
            >
              <span className="material-symbols-outlined text-2xl">add_circle</span>
              <span className="font-headline text-[10px] font-semibold uppercase tracking-widest mt-1">Compose</span>
            </a>
            <a 
              className={`flex flex-col items-center justify-center rounded-xl px-4 py-1 active:scale-90 active:duration-100 transition-all cursor-pointer ${currentView === 'history' ? 'text-[#ff0000] bg-red-50 dark:bg-[#1f1f1f]' : 'text-gray-400 dark:text-[#ababab] hover:text-[#ff0000] dark:hover:text-white'}`} 
              onClick={() => setCurrentView('history')}
            >
              <span className="material-symbols-outlined text-2xl">history</span>
              <span className="font-headline text-[10px] font-semibold uppercase tracking-widest mt-1">History</span>
            </a>
          </nav>
        </>
      )}

      {/* -------------------- ADMIN VIEWS -------------------- */}
      {currentView === 'admin_login' && (
        <div className="flex flex-col items-center justify-center pt-32 pb-40 px-6 max-w-sm mx-auto animate-[fadeIn_0.3s_ease] w-full text-center">
          <h2 className="text-4xl md:text-[2.5rem] font-black font-headline tracking-tighter mb-3 text-gray-900 dark:text-white leading-tight">ADMIN AREA</h2>
          <p className="text-gray-500 dark:text-[#ababab] text-sm md:text-base font-medium mb-12">Masukan sandi untuk mengakses</p>
          
          <form className="w-full text-left" onSubmit={(e) => {
              e.preventDefault();
              if(adminPassword === 'admin123') {
                setIsAdminMode(true);
                setCurrentView('admin_dashboard');
                displayToast('Akses Diberikan. System Override.');
              } else {
                displayToast('Sandi salah!');
              }
            }}>
            
            <label className="block text-[10px] font-bold tracking-[0.2em] text-[#ff0000] mb-3 uppercase">Protokol Akses</label>
            <div className="relative mb-8 rounded-xl overflow-hidden bg-gray-100 dark:bg-[#1a1a1a]">
              <input 
                type={showAdminPassword ? 'text' : 'password'} 
                value={adminPassword} 
                onChange={e => setAdminPassword(e.target.value)} 
                className="w-full bg-transparent text-gray-900 dark:text-white border-none outline-none focus:ring-0 px-5 py-4 font-bold tracking-[0.3em] placeholder-gray-400 dark:placeholder-[#444] transition-colors peer" 
                placeholder="SANDI RAHASIA" 
                autoFocus
              />
              <button 
                type="button" 
                onClick={() => setShowAdminPassword(!showAdminPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-[#ff0000] transition-colors p-1 z-10"
              >
                <span className="material-symbols-outlined text-[20px]">{showAdminPassword ? 'visibility_off' : 'visibility'}</span>
              </button>
              {/* Animated Loading Border 0-100 */}
              <div className="absolute bottom-0 left-0 h-[3px] bg-gradient-to-r from-[#ff0000] to-[#ff4d4d] w-0 peer-focus:w-full transition-all duration-500 ease-out shadow-[0_0_10px_rgba(255,0,0,0.8)]"></div>
            </div>
            
            <button 
              type="submit" 
              className="w-full bg-gradient-to-r from-[#e60000] to-[#ff4d4d] dark:from-[#b30000] dark:to-[#ff3333] hover:brightness-110 text-white font-extrabold py-4 rounded-xl transition-all shadow-[0_0_20px_rgba(255,0,0,0.15)] dark:shadow-[0_0_20px_rgba(255,0,0,0.3)] active:scale-95 uppercase tracking-[0.2em] text-sm"
            >
              BUKA AKSES
            </button>
          </form>

          <div className="mt-16 flex flex-col items-center gap-4">
            <button 
              onClick={() => setCurrentView('feed')} 
              className="text-[10px] font-bold tracking-[0.1em] text-gray-400 dark:text-[#555] uppercase hover:text-[#ff0000] dark:hover:text-white transition-colors"
            >
              ENKRIPSI END-TO-END // KEMBALI
            </button>
            <div className="w-1.5 h-1.5 rounded-full bg-[#ff0000] opacity-50 shadow-[0_0_8px_rgba(255,0,0,1)] animate-pulse"></div>
          </div>
        </div>
      )}

      {/* -------------------- CONTACT ADMIN PAGE -------------------- */}
      {currentView === 'contact_admin' && (
        <div className="pt-28 pb-40 px-6 max-w-lg mx-auto animate-[fadeIn_0.3s_ease]">
          <h2 className="text-3xl md:text-4xl font-black font-headline tracking-tighter leading-tight text-gray-900 dark:text-white mb-1">HUBUNGI</h2>
          <h2 className="text-3xl md:text-4xl font-black font-headline tracking-tighter leading-tight text-[#ff0000] mb-4">ADMIN</h2>
          <p className="text-gray-500 dark:text-[#ababab] text-sm font-medium mb-10 leading-relaxed">Sampaikan laporanmu dengan mengisi form dibawah ini, kami akan menghubungi balik dalam 1x24 Jam</p>
          
          <div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!contactMessage.trim()) { displayToast('Pesan tidak boleh kosong!'); return; }
              setIsContactSending(true);
              try {
                await axios.post(`${API_URL}/contact`, { email: contactEmail, message: contactMessage });
                displayToast('Pesan berhasil terkirim ke tim admin!');
                setContactEmail('');
                setContactMessage('');
              } catch (err) {
                displayToast(err.response?.data?.error || 'Gagal mengirim pesan.');
              } finally {
                setIsContactSending(false);
              }
            }}>
            <div className="space-y-6">
              <div>
                <label className="block text-[10px] font-bold tracking-[0.2em] text-gray-700 dark:text-gray-300 mb-3 uppercase">Email Kamu</label>
                <div className="bg-gray-100/70 dark:bg-white/5 backdrop-blur-md rounded-2xl overflow-hidden border border-gray-200/50 dark:border-white/5">
                  <div className="relative">
                    <input 
                      type="email" 
                      value={contactEmail} 
                      onChange={e => setContactEmail(e.target.value)} 
                      className="w-full bg-transparent text-gray-900 dark:text-white border-none outline-none focus:ring-0 px-5 py-4 font-semibold placeholder-gray-400 dark:placeholder-[#444] transition-colors text-sm peer" 
                      placeholder="identity@cipher.net"
                    />
                    <div className="absolute bottom-0 left-0 h-[3px] bg-gradient-to-r from-[#ff0000] to-[#ff4d4d] w-0 peer-focus:w-full transition-all duration-500 ease-out shadow-[0_0_10px_rgba(255,0,0,0.8)]"></div>
                  </div>
                </div>
              </div>
              
              <div>
                <label className="block text-[10px] font-bold tracking-[0.2em] text-gray-700 dark:text-gray-300 mb-3 uppercase">Pesan Yang Mau Disampaikan</label>
                <div className="bg-gray-100/70 dark:bg-white/5 backdrop-blur-md rounded-2xl overflow-hidden border border-gray-200/50 dark:border-white/5">
                  <div className="relative">
                    <textarea 
                      value={contactMessage}
                      onChange={e => setContactMessage(e.target.value)}
                      className="w-full bg-transparent text-gray-900 dark:text-white border-none outline-none focus:ring-0 px-5 py-4 font-semibold placeholder-gray-400 dark:placeholder-[#444] transition-colors resize-none text-sm peer"
                      rows="5"
                      placeholder="Ketik bisikanmu di sini..."
                    />
                    <div className="absolute bottom-0 left-0 h-[3px] bg-gradient-to-r from-[#ff0000] to-[#ff4d4d] w-0 peer-focus:w-full transition-all duration-500 ease-out shadow-[0_0_10px_rgba(255,0,0,0.8)]"></div>
                  </div>
                </div>
              </div>
              </div>
              
              <button 
                type="submit"
                disabled={isContactSending}
                className="mt-6 w-full bg-gradient-to-r from-[#e60000] to-[#ff4d4d] dark:from-[#b30000] dark:to-[#ff3333] hover:brightness-110 text-white font-extrabold py-4 rounded-xl transition-all shadow-[0_0_20px_rgba(255,0,0,0.15)] dark:shadow-[0_0_20px_rgba(255,0,0,0.3)] active:scale-95 uppercase tracking-[0.2em] text-sm flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isContactSending ? (
                  <><span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span> MENGIRIM...</>
                ) : (
                  <><span>SEND PULSE</span> <span className="material-symbols-outlined text-[20px]">send</span></>
                )}
              </button>
            </form>
          </div>

          <div className="mt-10 text-center">
            <button onClick={() => setCurrentView('feed')} className="text-[10px] font-bold tracking-[0.1em] text-gray-400 dark:text-[#555] uppercase hover:text-[#ff0000] dark:hover:text-white transition-colors">
              KEMBALI KE FEED
            </button>
          </div>
        </div>
      )}

      {currentView === 'admin_dashboard' && isAdminMode && (
        <div className="pt-28 pb-40 px-4 md:px-8 max-w-5xl mx-auto animate-[fadeIn_0.3s_ease]">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 border-b border-gray-200 dark:border-gray-800 pb-4 gap-4">
             <div>
                <h2 className="text-2xl md:text-3xl font-black tracking-tighter text-gray-900 dark:text-white flex items-center gap-2">
                  <span className="material-symbols-outlined text-[#ff0000] text-3xl" style={{ fontVariationSettings: "'FILL' 1" }}>admin_panel_settings</span>
                  Moderation Root Terminal
                </h2>
                <p className="text-xs md:text-sm font-bold text-[#ff0000] mt-1 font-mono tracking-widest border border-[#ff0000]/20 bg-[#ff0000]/10 px-2 py-1 rounded inline-block">
                  DANGEROUS ZONE. ACTION CANNOT BE UNDONE.
                </p>
             </div>
             <button 
               onClick={() => { setIsAdminMode(false); setCurrentView('feed'); setAdminPassword(''); displayToast('Sesi Admin Diakhiri.'); }} 
               className="bg-gray-100 dark:bg-[#1a1a1a] text-gray-700 dark:text-gray-400 px-4 py-2 rounded-lg text-xs font-bold hover:bg-red-100 hover:text-[#ff0000] dark:hover:text-[#ff0000] transition-colors border border-gray-200 dark:border-gray-800"
             >
               LOGOUT SESSION
             </button>
          </div>

          {/* Admin Tab Navigation */}
          <div className="flex gap-2 mb-6">
            <button 
              onClick={() => setAdminTab('menfess')} 
              className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${adminTab === 'menfess' ? 'bg-[#ff0000] text-white shadow-lg' : 'bg-gray-100 dark:bg-[#1a1a1a] text-gray-500 hover:text-[#ff0000] border border-gray-200 dark:border-gray-800'}`}
            >
              <span className="flex items-center gap-2"><span className="material-symbols-outlined text-[16px]">forum</span> Menfess</span>
            </button>
            <button 
              onClick={() => { setAdminTab('inbox'); fetchContactMessages(); }} 
              className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${adminTab === 'inbox' ? 'bg-[#ff0000] text-white shadow-lg' : 'bg-gray-100 dark:bg-[#1a1a1a] text-gray-500 hover:text-[#ff0000] border border-gray-200 dark:border-gray-800'}`}
            >
              <span className="flex items-center gap-2"><span className="material-symbols-outlined text-[16px]">inbox</span> Pesan Masuk</span>
            </button>
          </div>

          {/* Tab: Menfess */}
          {adminTab === 'menfess' && (
          <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 rounded-xl overflow-x-auto shadow-md">
             <table className="w-full text-left border-collapse min-w-[700px]">
               <thead>
                 <tr className="border-b border-gray-200 dark:border-gray-800 text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 font-bold bg-gray-50 dark:bg-[#202020]">
                   <th className="p-4 w-[15%]">ID / Sender</th>
                   <th className="p-4 w-[50%]">Content</th>
                   <th className="p-4 w-[20%]">Stats</th>
                   <th className="p-4 w-[15%] text-right pr-6">Action</th>
                 </tr>
               </thead>
               <tbody className="text-sm font-medium">
                 {menfessList.map(item => (
                   <tr key={item.id} className="border-b border-gray-100 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-[#252525] transition-colors">
                     <td className="p-4 align-top">
                       <div className="text-[#ff0000] font-bold text-xs bg-[#ff0000]/10 inline-block px-2 py-0.5 rounded">{item.unique_id}</div>
                       <div className="text-xs text-gray-500 dark:text-gray-400 mt-2 font-semibold">User: {item.sender_name}</div>
                       <div className="text-[10px] text-gray-400 mt-1">{new Date(item.created_at).toLocaleDateString()}</div>
                     </td>
                     <td className="p-4 align-top text-gray-800 dark:text-gray-300 break-words">
                       {item.content}
                     </td>
                     <td className="p-4 align-top text-gray-500 dark:text-gray-400 text-xs font-mono">
                        <div className="flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">favorite</span> {item.likes || 0} Likes</div>
                        <div className="flex items-center gap-1 mt-1"><span className="material-symbols-outlined text-[14px]">comment</span> {item.comments?.length || 0} Replies</div>
                     </td>
                     <td className="p-4 align-top text-right pr-6">
                       <button 
                         onClick={() => handleDeleteMenfess(item.id)} 
                         className="text-gray-400 hover:text-white hover:bg-[#ff0000] p-2 rounded-lg transition-all active:scale-90" 
                         title="Dematerialize Post"
                       >
                         <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>delete_forever</span>
                       </button>
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
             {menfessList.length === 0 && (
               <div className="text-center p-12 text-gray-500 font-mono text-sm tracking-widest flex flex-col items-center gap-2">
                 <span className="material-symbols-outlined text-4xl opacity-20">inventory_2</span>
                 ARCHIVE CLEARED
               </div>
             )}
          </div>
          )}

          {/* Tab: Pesan Masuk / Inbox */}
          {adminTab === 'inbox' && (
          <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden shadow-md">
            {contactMessages.length === 0 ? (
              <div className="text-center p-12 text-gray-500 font-mono text-sm tracking-widest flex flex-col items-center gap-2">
                <span className="material-symbols-outlined text-4xl opacity-20">mark_email_read</span>
                KOTAK MASUK KOSONG
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {contactMessages.map(msg => (
                  <div key={msg.id} className="p-5 hover:bg-gray-50 dark:hover:bg-[#252525] transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[#ff0000] text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>mail</span>
                        <span className="text-sm font-bold text-gray-900 dark:text-white">{msg.email || 'anonim@archifes.id'}</span>
                      </div>
                      <span className="text-[10px] text-gray-400 font-mono">{new Date(msg.created_at).toLocaleString()}</span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 font-medium leading-relaxed pl-7">{msg.message}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          )}
        </div>
      )}

      {/* Compose Modal (Only visible in user views) */}
      {isModalOpen && (currentView === 'feed' || currentView === 'history') && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content bg-white dark:bg-[#1f1f1f] p-8 rounded-2xl shadow-2xl border border-gray-200 dark:border-[#262626] overflow-hidden transition-colors duration-300" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white flex items-center gap-2">
                <span className="material-symbols-outlined text-[#ff0000]">edit_square</span> 
                Tulis Sesuatu.
              </h2>
              <button className="text-gray-500 dark:text-[#ababab] hover:text-black dark:hover:text-white transition-colors" onClick={() => setIsModalOpen(false)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            
            {errorMsg && (
              <div className="bg-red-50 text-red-500 dark:bg-red-500/10 dark:text-red-400 p-3 rounded-lg mb-4 text-sm font-semibold flex items-center gap-2 border border-red-200 dark:border-red-500/50">
                 <span className="material-symbols-outlined">error</span>
                 {errorMsg}
              </div>
            )}

            <form onSubmit={handleComposeSubmit} className="space-y-4">
              <div>
                <input 
                  type="text" 
                  className="w-full bg-gray-50 text-gray-900 dark:bg-[#0e0e0e] dark:text-white border border-gray-200 dark:border-gray-700 focus:border-[#ff0000] focus:ring-1 focus:ring-[#ff0000] rounded-xl p-3 font-medium placeholder-gray-400 dark:placeholder-gray-500 transition-colors"
                  placeholder="Nama Samaran (Biarkan kosong untuk Anonim)"
                  value={senderName}
                  onChange={e => setSenderName(e.target.value)}
                  maxLength={30}
                />
              </div>

              <div>
                <textarea 
                  className="w-full bg-gray-50 text-gray-900 dark:bg-[#0e0e0e] dark:text-white border border-gray-200 dark:border-gray-700 focus:border-[#ff0000] focus:ring-1 focus:ring-[#ff0000] rounded-xl p-4 font-medium resize-none placeholder-gray-400 dark:placeholder-gray-500 transition-colors"
                  rows="4" 
                  placeholder="Ceritakan sesuatu ke dunia rahasia ini..."
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  maxLength={280}
                  required
                ></textarea>
                <div className="text-right text-xs mt-1 text-gray-500 dark:text-gray-400 font-bold">
                  <span className={content.length > 250 ? 'text-[#ff0000]' : ''}>{content.length}</span>/280
                </div>
              </div>

              <button 
                type="submit" 
                className="w-full bg-[#ff0000] hover:bg-[#cc0000] text-white dark:text-[#f8d7da] font-bold py-4 rounded-xl shadow-lg shadow-[#ff0000]/20 transition-all active:scale-[0.98] mt-4 flex items-center justify-center gap-2"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Mengirim...' : (
                  <>
                    <span className="uppercase tracking-widest text-sm">Pancarkan Pesan</span>
                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>send</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Sidebar Navigation -> Drawer Mode with Smooth Slide */}
      {isSidebarOpen && (
        <>
          {/* Backdrop Blur */}
          <div 
             className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-[1000] ${isSidebarClosing ? 'overlay-leave' : 'animate-[fadeIn_0.3s_ease]'}`} 
             onClick={closeSidebar}
          ></div>

          {/* Sidebar Content */}
          <div className={`fixed top-0 left-0 h-full w-[85%] max-w-[320px] bg-white/70 dark:bg-[#121212]/70 backdrop-blur-2xl z-[1001] shadow-[10px_0_30px_rgba(0,0,0,0.5)] ${isSidebarClosing ? 'sidebar-leave' : 'sidebar-enter'} flex flex-col`}>
            <div className="p-6 border-b border-gray-200/50 dark:border-white/5 flex justify-between items-center bg-red-50/40 dark:bg-white/5">
               <h3 className="font-black text-gray-900 dark:text-white flex items-center gap-2 tracking-tighter text-xl">
                 <span className="material-symbols-outlined text-[#ff0000] text-[28px]" style={{ fontVariationSettings: "'FILL' 1" }}>architecture</span>
                 Menu Utama
               </h3>
               <button className="text-gray-500 dark:text-[#ababab] hover:text-black dark:hover:text-white transition-colors p-1" onClick={closeSidebar}>
                 <span className="material-symbols-outlined">close</span>
               </button>
            </div>
            
            <div className="py-6 flex flex-col gap-2 px-6 flex-1 overflow-y-auto">
               <button onClick={() => { closeSidebar(); setTimeout(() => setCurrentView('admin_login'), 280); }} className="flex items-center gap-4 w-full text-left p-4 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300 hover:text-[#ff0000] dark:hover:text-[#ff0000] transition-all font-bold text-sm group">
                  <span className="material-symbols-outlined group-hover:scale-110 transition-transform text-[#ff0000] dark:text-gray-400 dark:group-hover:text-[#ff0000]" style={{ fontVariationSettings: "'FILL' 1" }}>admin_panel_settings</span> 
                  Login Administrator
               </button>
               
               <button onClick={() => { closeSidebar(); setTimeout(() => setCurrentView('contact_admin'), 280); }} className="flex items-center gap-4 w-full text-left p-4 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300 hover:text-[#ff0000] dark:hover:text-[#ff0000] transition-all font-bold text-sm group border border-transparent">
                  <span className="material-symbols-outlined group-hover:scale-110 transition-transform text-gray-400 group-hover:text-[#ff0000]" style={{ fontVariationSettings: "'FILL' 1" }}>support_agent</span> 
                  Hubungi Tim Admin
               </button>
               
               <button onClick={() => { closeSidebar(); setTimeout(() => displayToast('Fitur Kotak Masukan segera hadir di versi berikutnya!'), 280); }} className="flex items-center gap-4 w-full text-left p-4 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-gray-700 dark:text-gray-300 hover:text-[#ff0000] dark:hover:text-[#ff0000] transition-all font-bold text-sm group border border-transparent">
                  <span className="material-symbols-outlined group-hover:scale-110 transition-transform text-gray-400 group-hover:text-[#ff0000]" style={{ fontVariationSettings: "'FILL' 1" }}>feedback</span> 
                  Kritik & Masukan Positif
               </button>
            </div>
            
            <div className="p-5 border-t border-gray-200/50 dark:border-white/5 text-center bg-black/5 dark:bg-black/20">
               <div className="text-[11px] font-extrabold text-gray-500 tracking-widest uppercase">ArchiFes v1.0.0</div>
               <div className="text-[10px] text-gray-500 mt-1 font-semibold">Platform Anonim Mahasiswa Arsitektur Unnes</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
